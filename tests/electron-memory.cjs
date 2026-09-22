const {_electron: electron} = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const runDir = path.join(root, 'artifacts', `memory-${Date.now()}`);
fs.mkdirSync(runDir, {recursive: true});
const fixture = path.join(runDir, 'Orchid.epub');
execFileSync(path.join(root,'.venv','Scripts','python.exe'), [path.join(root,'tests','test_epub_folders.py'),fixture,'4200'], {env: {...process.env, PYTHONPATH: root}});
let app, page;
const embedding = 'text-embedding-qwen3-embedding-0.6b';
async function catalog() {
  return (await fetch('http://127.0.0.1:1234/api/v1/models').then(r=>r.json())).models;
}
async function resident() {
  return (await catalog()).find(m=>m.key===embedding).loaded_instances.length>0;
}
async function until(check, timeout=90000) {
  const end = Date.now() + timeout;
  while(Date.now()<end) {
    if(await check()) return;
    await new Promise(r=>setTimeout(r,250));
  }
  throw new Error('Timed out waiting for expected model state');
}
function freeVRAM() {
  return Number(execFileSync('nvidia-smi',['--query-gpu=memory.free','--format=csv,noheader,nounits'],{encoding:'utf8'}).trim());
}
(async()=>{
  const errors=[];
  try {
    app = await electron.launch({executablePath:path.join(root,'dist','Local-RAG-win32-x64','Local-RAG.exe'),args:[],env:{...process.env,LOCAL_RAG_DATA_DIR:path.join(runDir,'library')}});
    page=await app.firstWindow(); page.setDefaultTimeout(15000);
    page.on('pageerror',e=>errors.push(e.message));
    await page.waitForLoadState('networkidle');
    await app.evaluate(({BrowserWindow})=>{ const win=BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.hide(); });
    await page.locator('#file-input').setInputFiles(fixture);
    await until(async()=>page.evaluate(async()=>{
      const docs=await fetch('/api/documents').then(r=>r.json()); return docs.length===1 && docs[0].status==='ready';
    }));
    assert.ok(await resident());
    const freeBefore=freeVRAM();
    const catalogBefore=await catalog();
    await until(async()=>!await resident(),45000);
    const freeAfter=freeVRAM();
    const catalogAfter=await catalog();
    assert.deepEqual(catalogAfter.find(m=>m.key==='qwen3.5-9b').loaded_instances,catalogBefore.find(m=>m.key==='qwen3.5-9b').loaded_instances);
    await page.locator('#settings-button').click();
    await page.locator('#settings-dialog').waitFor({state:'visible'});
    assert.equal(await page.locator('select[name="embedding_idle_unload"]').inputValue(),'true');
    await page.locator('select[name="embedding_idle_unload"]').selectOption('false');
    await page.locator('#settings-form button[type="submit"]').click();
    await page.locator('#settings-dialog').waitFor({state:'hidden'});
    await page.locator('#question').fill('Orchid 計劃預算是多少港元？請引用文件。');
    await page.locator('#send').click();
    await page.locator('.message.assistant .message-footer').waitFor({timeout:90000});
    await page.locator('#send').waitFor({state:'visible'});
    const answer=await page.locator('.message.assistant .message-content').textContent();
    assert.ok(answer.replaceAll(',','').includes('4200'),answer);
    assert.ok(await resident());
    assert.ok(await page.locator('.citation').count());
    // The disabled preference also protects the model from the desktop close request.
    await app.close(); app=null;
    assert.ok(await resident());
    // Restart confirms the setting persists, then enable cleanup and make another real query.
    app = await electron.launch({executablePath:path.join(root,'dist','Local-RAG-win32-x64','Local-RAG.exe'),args:[],env:{...process.env,LOCAL_RAG_DATA_DIR:path.join(runDir,'library')}});
    page=await app.firstWindow(); await page.waitForLoadState('networkidle');
    await app.evaluate(({BrowserWindow})=>{ const win=BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.hide(); });
    await page.locator('#settings-button').click();
    await page.locator('#settings-dialog').waitFor({state:'visible'});
    assert.equal(await page.locator('select[name="embedding_idle_unload"]').inputValue(),'false');
    await page.locator('select[name="embedding_idle_unload"]').selectOption('true');
    await page.locator('#settings-form button[type="submit"]').click();
    await page.locator('#settings-dialog').waitFor({state:'hidden'});
    await page.locator('#question').fill('Orchid 計劃預算是多少？');
    await page.locator('#send').click();
    await page.locator('.message.assistant .message-footer').waitFor({timeout:90000});
    await page.locator('#send').waitFor({state:'visible'});
    await app.close(); app=null;
    assert.equal(await resident(),false);
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(runDir,'result.json'),JSON.stringify({passed:true,packaged:true,freeBeforeMiB:freeBefore,freeAfterMiB:freeAfter,freeIncreaseMiB:freeAfter-freeBefore,answer,checks:['30 second idle unload','LLM unchanged','automatic reload and grounded answer','preference persists','keep-loaded preference honored on close','release on desktop close']},null,2));
    console.log(runDir);
  } catch(error) {console.error(error);process.exitCode=1;}
  finally {if(app) await app.close();}
})();
