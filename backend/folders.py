"""Persistent, incremental folder imports. Never writes to the user's source folder."""
import os
from pathlib import Path
import threading
import time
import uuid


class FolderSync:
    def __init__(self, library, interval=10):
        self.library = library
        self.interval = interval
        self.stop = threading.Event()
        self.wake = threading.Event()
        self.lock = threading.RLock()
        self.thread = None
        self.observed = {}
        with library.connect() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS folders (
                id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, last_scan REAL,
                error TEXT, scanning INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS folder_files (
                folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
                path TEXT NOT NULL, signature TEXT, present INTEGER NOT NULL DEFAULT 1,
                document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
                pending_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
                error TEXT, PRIMARY KEY(folder_id,path));
            UPDATE folders SET scanning=0;
            ''')

    def start(self):
        self.thread = threading.Thread(target=self.run, daemon=True, name='folder-sync')
        self.thread.start()

    def run(self):
        while not self.stop.is_set():
            try:
                self.scan()
            except Exception as error:
                with self.library.connect() as db:
                    db.execute('UPDATE folders SET error=?,scanning=0', (str(error)[:500],))
            self.wake.wait(self.interval)
            self.wake.clear()

    def close(self):
        self.stop.set()
        self.wake.set()
        if self.thread:
            self.thread.join()

    def folders(self):
        with self.library.connect() as db:
            result = []
            for row in db.execute('SELECT * FROM folders ORDER BY path'):
                files = [dict(f) for f in db.execute('''SELECT f.*,d.status,d.error AS import_error
                    FROM folder_files f LEFT JOIN documents d ON d.id=coalesce(f.pending_id,f.document_id)
                    WHERE f.folder_id=? ORDER BY f.path''', (row['id'],))]
                result.append(dict(row) | {'files': files})
            return result

    def add(self, folder):
        path = Path(folder).expanduser().resolve(strict=True)
        if not path.is_dir():
            raise ValueError('請選擇資料夾。')
        if path == Path(path.anchor):
            raise ValueError('請選擇文件資料夾，不能監察整個磁碟。')
        library_path = self.library.root.resolve()
        if path == library_path or path in library_path.parents or library_path in path.parents:
            raise ValueError('請選擇原始文件資料夾，不能監察 app 的資料目錄。')
        with self.lock, self.library.connect() as db:
            for existing in db.execute('SELECT * FROM folders'):
                previous = Path(existing['path'])
                if previous == path:
                    return dict(existing)
                if previous in path.parents or path in previous.parents:
                    raise ValueError('此資料夾與已連接的資料夾重疊；子資料夾已會自動包含。')
            identifier = uuid.uuid4().hex
            db.execute('INSERT INTO folders(id,path) VALUES (?,?)', (identifier, str(path)))
        self.wake.set()
        return {'id': identifier, 'path': str(path)}

    def remove(self, identifier):
        # Detaching keeps all imported copies, including any in-flight replacement.
        with self.lock, self.library.connect() as db:
            db.execute('DELETE FROM folders WHERE id=?', (identifier,))

    def request_scan(self):
        with self.lock, self.library.connect() as db:
            # Recheck read/format errors. Failed embedding jobs use the document Retry button.
            db.execute('UPDATE folder_files SET signature=NULL WHERE error IS NOT NULL')
        self.wake.set()

    def scan(self):
        with self.lock:
            for folder in self.folders():
                if self.stop.is_set():
                    return
                self.scan_folder(folder)

    def settle(self, folder_id):
        """Publish a replacement only after every chunk and vector was committed."""
        library = self.library
        with library.write_lock, library.connect() as db:
            rows = db.execute('''SELECT f.*,d.status FROM folder_files f JOIN documents d
                ON d.id=f.pending_id WHERE folder_id=?''', (folder_id,)).fetchall()
            retired = set()
            for row in rows:
                if row['status'] != 'ready':
                    continue
                if row['document_id'] and row['document_id'] != row['pending_id']:
                    retired.add(row['document_id'])
                    db.execute('UPDATE documents SET category_id=(SELECT category_id FROM documents WHERE id=?) WHERE id=? AND category_id IS NULL', (row['document_id'], row['pending_id']))
                db.execute('UPDATE folder_files SET document_id=pending_id,pending_id=NULL,error=NULL WHERE folder_id=? AND path=?', (folder_id, row['path']))
            db.commit()
            for identifier in retired:
                doc = library.document(identifier)
                referenced = db.execute('SELECT 1 FROM folder_files WHERE document_id=? OR pending_id=?', (identifier, identifier)).fetchone()
                if doc and doc['managed'] and not referenced:
                    library.delete(identifier)

    def scan_folder(self, folder):
        library = self.library
        identifier = folder['id']
        self.settle(identifier)
        with library.connect() as db:
            db.execute('UPDATE folders SET scanning=1,error=NULL WHERE id=?', (identifier,))
        seen = set()
        try:
            root = Path(folder['path'])
            if not root.is_dir():
                raise ValueError('資料夾暫時無法存取；已匯入的副本會保留。')

            def walk_error(error):
                raise error

            for directory, dirs, files in os.walk(root, followlinks=False, onerror=walk_error):
                dirs[:] = [d for d in dirs if not self.is_link(Path(directory) / d)]
                for name in files:
                    if self.stop.is_set():
                        return
                    path = Path(directory) / name
                    if path.suffix.lower() not in ('.pdf', '.epub') or self.is_link(path):
                        continue
                    key = str(path.relative_to(root))
                    seen.add(key)
                    self.scan_file(identifier, key, path)
            with library.connect() as db:
                for row in db.execute('SELECT path FROM folder_files WHERE folder_id=?', (identifier,)).fetchall():
                    db.execute('UPDATE folder_files SET present=? WHERE folder_id=? AND path=?', (int(row['path'] in seen), identifier, row['path']))
            self.settle(identifier)
        except Exception as error:
            with library.connect() as db:
                db.execute('UPDATE folders SET error=? WHERE id=?', (str(error)[:500], identifier))
        finally:
            with library.connect() as db:
                db.execute('UPDATE folders SET scanning=0,last_scan=? WHERE id=?', (time.time(), identifier))

    @staticmethod
    def is_link(path):
        return path.is_symlink() or bool(getattr(path.stat(follow_symlinks=False), 'st_file_attributes', 0) & 0x400)

    def scan_file(self, folder_id, key, path):
        library = self.library
        signature = None
        try:
            stat = path.stat()
            signature = f'{stat.st_size}:{stat.st_mtime_ns}'
            with library.connect() as db:
                row = db.execute('SELECT * FROM folder_files WHERE folder_id=? AND path=?', (folder_id, key)).fetchone()
            if row and (row['signature'] == signature or row['pending_id']):
                # A failed replacement must be retried or replaced by a newer source version.
                pending = library.document(row['pending_id']) if row['pending_id'] else None
                if not pending or pending['status'] != 'error' or row['signature'] == signature:
                    return
            observation = (folder_id, key)
            previous = self.observed.get(observation)
            self.observed[observation] = signature
            if previous != signature:
                return  # Two equal observations avoid reading a file still being copied.
            if stat.st_size > 50 * 1024 * 1024:
                raise ValueError('每份文件上限為 50 MB。')
            with path.open('rb') as source:
                content = source.read(50 * 1024 * 1024 + 1)
            after = path.stat()
            if (after.st_size, after.st_mtime_ns) != (stat.st_size, stat.st_mtime_ns):
                return
            with library.write_lock:
                result = library.enqueue(path.name, content, managed=True)
                with library.connect() as db:
                    db.execute('''INSERT INTO folder_files(folder_id,path,signature,pending_id) VALUES (?,?,?,?)
                        ON CONFLICT(folder_id,path) DO UPDATE SET signature=excluded.signature,
                        pending_id=excluded.pending_id,error=NULL,present=1''', (folder_id, key, signature, result['id']))
        except Exception as error:
            with library.connect() as db:
                db.execute('''INSERT INTO folder_files(folder_id,path,signature,error) VALUES (?,?,?,?)
                    ON CONFLICT(folder_id,path) DO UPDATE SET signature=excluded.signature,error=excluded.error''',
                    (folder_id, key, signature, str(error)[:500]))
