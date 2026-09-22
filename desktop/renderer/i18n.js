/* UI copy only. Document text, names, category names and answers remain untouched. */
const I18n = (() => {
  const copy = [
    [
      "目前範圍沒有已完成處理的文件，請重新選擇。",
      "No processed documents in this scope. Select documents to search.",
      "この範囲に処理済みの文書がありません。検索する文書を選んでください。",
    ],
    [
      "辨識文字與符號：第 {page}/{total} 頁",
      "Reading text and symbols: page {page}/{total}",
      "文字と記号を認識中：{page}/{total} ページ",
    ],
    [
      "匯入被中斷，請按重試。",
      "Import interrupted. Please retry.",
      "取り込みが中断されました。再試行してください。",
    ],
    [
      "未找到可讀文字。",
      "No readable text found.",
      "読み取り可能なテキストがありません。",
    ],
    [
      "只支援 PDF 或 EPUB 文件。",
      "Only PDF and EPUB files are supported.",
      "PDF と EPUB のみ対応しています。",
    ],
    [
      "每份文件上限為 50 MB。",
      "Each file must be 50 MB or smaller.",
      "1 ファイルの上限は 50 MB です。",
    ],
    [
      "這不是有效的 PDF 文件。",
      "This is not a valid PDF file.",
      "有効な PDF ファイルではありません。",
    ],
    [
      "這不是有效的 EPUB 文件。",
      "This is not a valid EPUB file.",
      "有効な EPUB ファイルではありません。",
    ],
    [
      "此 PDF 有密碼，請先解鎖再匯入。",
      "Unlock this password-protected PDF before importing.",
      "パスワードを解除してから PDF を取り込んでください。",
    ],
    [
      "請等候文件處理完成再刪除。",
      "Wait for processing to finish before deleting.",
      "処理が完了してから削除してください。",
    ],
    [
      "文件庫非空時不能更換 embedding 模型。請先刪除文件，再重新匯入。",
      "The embedding model cannot change while the library contains documents. Remove the documents, then reimport them.",
      "文書がある状態では埋め込みモデルを変更できません。文書を削除してから再取り込みしてください。",
    ],
    [
      "對話已不存在，請建立新對話。",
      "Conversation no longer exists. Start a new conversation.",
      "会話がありません。新しい会話を開始してください。",
    ],
    [
      "回答達到 token 上限，未完整答案不會保存。請縮短問題或在設定提高回答上限。",
      "Answer token limit reached; the incomplete answer was not saved. Shorten the question or increase the limit in Settings.",
      "回答トークン上限に達したため未完了の回答は保存されません。質問を短くするか設定で上限を増やしてください。",
    ],
    [
      "模型未完整返回答案，請重試。",
      "The model did not return a complete answer. Please retry.",
      "モデルの回答が未完了です。再試行してください。",
    ],
    [
      "LM Studio 回應 {code}。請確認已下載並載入模型 {model}。",
      "LM Studio returned {code}. Check that model {model} is downloaded and loaded.",
      "LM Studio 応答：{code}。モデル {model} のダウンロードと読み込みを確認してください。",
    ],
    [
      "問題太長，無法保留足夠的文件證據，請縮短問題後重試。",
      "Question too long to leave room for evidence. Shorten it and retry.",
      "証拠を含める空きが不足しています。質問を短くして再試行してください。",
    ],
    ["所有文件", "All documents", "すべての文書"],
    ["所有分類", "All categories", "すべての分類"],
    ["未分類", "Uncategorized", "未分類"],
    ["文件已不存在", "Document no longer available", "文書が見つかりません"],
    ["分類已不存在", "Category no longer available", "分類が見つかりません"],
    ["已選 {count} 份文件", "{count} documents selected", "{count} 件を選択中"],
    ["選擇 {name}", "Select {name}", "{name} を選択"],
    ["分類名稱", "Category name", "分類名"],
    ["重新命名", "Rename", "名前を変更"],
    ["移除", "Remove", "削除"],
    [
      "請先勾選文件。",
      "Select some documents first.",
      "先に文書を選択してください。",
    ],
    ["分類已更新。", "Category updated.", "分類を更新しました。"],
    ["管理分類", "Manage categories", "分類を管理"],
    ["查詢分類", "Search category", "検索する分類"],
    ["勾選列表", "Select visible", "表示中を選択"],
    ["取消勾選", "Clear selection", "選択を解除"],
    ["移至分類", "Move to category", "分類へ移動"],
    ["關閉分類管理", "Close categories", "分類管理を閉じる"],
    [
      "例如作品系列、小說、論文或工作資料。先勾選文件，再移至分類。",
      "Group by series, fiction, research or work. Select documents, then move them to a category.",
      "シリーズ、小説、論文、仕事などで整理できます。文書を選択して分類へ移動してください。",
    ],
    ["新分類名稱", "New category name", "新しい分類名"],
    ["新增分類", "Add category", "分類を追加"],
    [
      "移除分類只會將文件移回「未分類」，不會刪除文件。",
      "Removing a category moves its documents to Uncategorized. Documents are kept.",
      "分類を削除すると文書は「未分類」に戻ります。文書自体は削除されません。",
    ],
    ["閱讀模式", "Reading mode", "読書モード"],
    ["一般文件", "General", "一般文書"],
    ["小說／敘事", "Fiction / narrative", "小説・物語"],
    [
      "補充同章上下文；局部片段不代表全書。",
      "Adds nearby chapter context; excerpts do not represent the whole book.",
      "同じ章の前後を補足します。抜粋は本全体を代表するものではありません。",
    ],
    [
      "Local RAG · 私人閱讀室",
      "Local RAG · Reading room",
      "Local RAG · 読書室",
    ],
    ["你的私人閱讀室", "Your private reading room", "あなただけの読書室"],
    ["開始新對話", "New conversation", "新しい会話"],
    ["文件庫", "Library", "ライブラリ"],
    ["＋ 連接資料夾", "＋ Connect folder", "＋ フォルダーを接続"],
    [
      "PDF / EPUB · 包含子資料夾 · 自動更新",
      "PDF / EPUB · Subfolders · Auto sync",
      "PDF / EPUB · サブフォルダーも自動更新",
    ],
    ["搜尋文件名稱…", "Find documents…", "文書名を検索…"],
    ["搜尋文件名稱", "Find documents by name", "文書名を検索"],
    ["管理資料夾", "Manage folders", "フォルダーを管理"],
    [
      "從整個文件庫尋找答案",
      "Search across your library",
      "ライブラリ全体から検索",
    ],
    ["加入個別文件", "Add individual files", "ファイルを追加"],
    [
      "PDF / EPUB · 或拖曳到這裡 · 上限 50 MB",
      "PDF / EPUB · Or drop files · Up to 50 MB",
      "PDF / EPUB · ドロップも可能 · 最大 50 MB",
    ],
    ["最近的對話", "Recent conversations", "最近の会話"],
    [
      "對話會保存在這部電腦",
      "Conversations stay on this computer",
      "会話はこのパソコンに保存されます",
    ],
    [
      "文件與對話儲存在本機",
      "Documents and chats stay local",
      "文書と会話はローカルに保存",
    ],
    ["設定", "Settings", "設定"],
    ["閱讀工作台", "Reading desk", "読書デスク"],
    ["介面語言", "Interface language", "表示言語"],
    ["正在連線…", "Connecting…", "接続中…"],
    ["讓文件，", "Turn documents,", "文書から、"],
    ["成為你的", "into your ", "あなたの"],
    ["答案。", "answers.", "答えへ。"],
    [
      "把論文、筆記與報告放進來。",
      "Bring your books, notes and papers.",
      "本、ノート、論文を追加しましょう。",
    ],
    [
      "提出問題，跟著引用回到原文。",
      "Ask a question. Follow the citations.",
      "質問して、引用から原文を確かめましょう。",
    ],
    ["加入你的文件", "Add your documents", "文書を追加"],
    ["用自然語言提問", "Ask in your own words", "自然な言葉で質問"],
    ["查看答案的出處", "Check the sources", "出典を確認"],
    [
      "這份文件的主要發現是甚麼？請附上引用。",
      "What are the main findings of this document? Cite your sources.",
      "この文書の主な知見は何ですか？出典も示してください。",
    ],
    ["整理重點", "Key points", "要点を整理"],
    [
      "這份文件的主要發現是甚麼？",
      "What are the main findings?",
      "この文書の主な知見は？",
    ],
    [
      "請根據文件解釋最重要的概念，並引用相關段落。",
      "Explain the most important concepts using the documents, with citations.",
      "文書の最も重要な概念を、該当箇所を引用して説明してください。",
    ],
    ["深入理解", "Explore a concept", "理解を深める"],
    [
      "解釋文件裡最重要的概念",
      "Explain the key concepts",
      "文書の重要な概念を説明",
    ],
    ["向你的文件提問…", "Ask your documents…", "文書について質問…"],
    ["問題", "Question", "質問"],
    [
      "Enter 傳送 · Shift + Enter 換行",
      "Enter to send · Shift + Enter for a new line",
      "Enter で送信 · Shift + Enter で改行",
    ],
    ["傳送問題", "Send question", "質問を送信"],
    ["停止", "Stop", "停止"],
    [
      "答案可能有誤，請透過引用核對原文。",
      "Answers may be incorrect. Check the cited passages.",
      "回答に誤りがある場合があります。引用箇所をご確認ください。",
    ],
    ["參考來源", "Sources", "出典"],
    [
      "沿著證據，回到原文。",
      "Follow the evidence back to the text.",
      "根拠をたどり、原文へ。",
    ],
    ["每個答案，都有出處", "Every answer has a source", "答えの根拠を確かめる"],
    [
      "提問後，相關段落會顯示在這裡。",
      "Relevant passages appear here after you ask.",
      "質問すると、関連する箇所がここに表示されます。",
    ],
    [
      "點擊引用，即可查看 PDF 原頁。",
      "Click a citation to open the PDF page.",
      "引用をクリックすると PDF の該当ページが開きます。",
    ],
    [
      "提問後，相關段落會顯示在這裡。\n點擊引用，即可查看 PDF 原頁或 EPUB 章節。",
      "Relevant passages appear here after you ask.\nClick a citation to open a PDF page or EPUB chapter.",
      "質問すると関連箇所を表示します。\n引用をクリックして PDF のページや EPUB の章を開けます。",
    ],
    [
      "以原文為依據，保留自己的判斷。",
      "Read the evidence. Make your own judgment.",
      "原文を確かめ、自分で判断しましょう。",
    ],
    ["模型與工作台", "Models & preferences", "モデルと設定"],
    ["關閉設定", "Close settings", "設定を閉じる"],
    [
      "連接本機 LM Studio。模型需先下載，並開啟 Local Server。",
      "Connect to local LM Studio. Download your models and start the Local Server first.",
      "ローカルの LM Studio に接続します。モデルをダウンロードし、Local Server を起動してください。",
    ],
    ["LM Studio 位址", "LM Studio address", "LM Studio のアドレス"],
    ["回答模型", "Answer model", "回答モデル"],
    ["選擇回答模型", "Choose answer model", "回答モデルを選択"],
    ["正在讀取本機模型…", "Reading local models…", "ローカルモデルを取得中…"],
    [
      "Model identifier（可自行輸入）",
      "Model identifier (editable)",
      "モデル識別子（直接入力可）",
    ],
    ["例如 qwen3.5-9b", "e.g. qwen3.5-9b", "例：qwen3.5-9b"],
    [
      "選擇已下載的模型，或自行輸入 LM Studio 的 model identifier。",
      "Choose a downloaded model or enter its LM Studio identifier.",
      "ダウンロード済みモデルを選ぶか、LM Studio の識別子を入力してください。",
    ],
    ["Embedding 模型", "Embedding model", "埋め込みモデル"],
    [
      "文件庫非空時不能更換 embedding 模型，避免索引錯配。",
      "The embedding model cannot change while the library contains documents.",
      "索引の不整合を防ぐため、文書がある状態では埋め込みモデルを変更できません。",
    ],
    ["Embedding 記憶體", "Embedding memory", "埋め込みモデルのメモリ"],
    [
      "用完後釋放（閒置 30 秒）",
      "Release after 30 seconds idle",
      "30 秒間未使用で解放",
    ],
    [
      "保持載入（搜尋較快）",
      "Keep loaded (faster searches)",
      "読み込みを維持（検索が高速）",
    ],
    [
      "匯入期間會保持載入；下次搜尋自動載回。已建立的索引會保留，回答模型不受影響。",
      "Kept loaded during imports; reloads on the next search. Saved indexes and the answer model are unaffected.",
      "取り込み中は維持し、次の検索時に再読み込みします。保存済みの索引と回答モデルはそのままです。",
    ],
    ["檢索段落數", "Passages to retrieve", "検索する抜粋数"],
    ["回答 token 上限", "Answer token limit", "回答トークン上限"],
    ["本地資料位置", "Local data location", "ローカルデータの保存先"],
    ["重新檢查連線", "Check connection", "接続を確認"],
    ["儲存設定", "Save settings", "設定を保存"],
    ["原文", "Original text", "原文"],
    ["關閉原文", "Close original text", "原文を閉じる"],
    ["PDF 原文", "Original PDF", "PDF 原文"],
    [
      "EPUB 章節文字 · 依書籍閱讀順序，並非固定頁碼",
      "EPUB chapter text · Reading order, not fixed page numbers",
      "EPUB の章本文 · 読書順です。固定ページ番号ではありません",
    ],
    ["已連接的資料夾", "Connected folders", "接続済みフォルダー"],
    ["關閉資料夾管理", "Close folder manager", "フォルダー管理を閉じる"],
    [
      "app 開啟時約每 10 秒檢查，待檔案穩定後處理。重新開啟會補掃。移走原檔或停止連接，都會保留已匯入的副本。",
      "Checks about every 10 seconds while open and catches up after restart. Stable files are imported. Removed sources and disconnected folders keep their library copies.",
      "起動中は約 10 秒ごとに確認し、安定したファイルを取り込みます。再起動後も変更を確認します。原本の移動や接続解除後も取り込み済みのコピーは残ります。",
    ],
    ["立即檢查", "Check now", "今すぐ確認"],
    ["連接資料夾", "Connect folder", "フォルダーを接続"],
    ["刪除這份文件？", "Delete this document?", "この文書を削除しますか？"],
    [
      "會刪除本地副本和搜尋索引，原始文件不受影響。舊對話的回答文字會保留。資料夾內相同版本不會再次自動加入；原檔更新後會重新匯入。",
      "Deletes the library copy and index, keeping the original file and past answers. The same folder version will not be imported again until the source changes.",
      "ライブラリのコピーと索引を削除します。原本と過去の回答は残ります。フォルダー内の同じ版は、原本が更新されるまで再取り込みしません。",
    ],
    ["取消", "Cancel", "キャンセル"],
    ["刪除文件", "Delete document", "文書を削除"],
    [
      "把 PDF / EPUB 放進你的閱讀室",
      "Drop PDF / EPUB files here",
      "PDF / EPUB をドロップ",
    ],
    [
      "文件只會儲存在這部電腦",
      "Files stay on this computer",
      "ファイルはこのパソコンに保存されます",
    ],
    [
      "設定或請求格式不正確。",
      "Invalid settings or request.",
      "設定またはリクエストが正しくありません。",
    ],
    [
      "請先等候回答完成或停止生成。",
      "Wait for the answer or stop generation first.",
      "回答の完了を待つか、生成を停止してください。",
    ],
    [
      "{pages} 頁 · {chunks} 個段落",
      "{pages} pages · {chunks} passages",
      "{pages} ページ · {chunks} 件の抜粋",
    ],
    [
      "{pages} 節 · {chunks} 個段落",
      "{pages} sections · {chunks} passages",
      "{pages} 節 · {chunks} 件の抜粋",
    ],
    ["處理失敗", "Processing failed", "処理に失敗しました"],
    [
      "正在處理 · {progress}%",
      "Processing · {progress}%",
      "処理中 · {progress}%",
    ],
    ["重試", "Retry", "再試行"],
    ["刪除 {name}", "Delete {name}", "{name} を削除"],
    [
      "連接資料夾，讓文件自動加入",
      "Connect a folder to add files automatically",
      "フォルダーを接続して自動で追加",
    ],
    [
      "沒有符合名稱的文件",
      "No documents match this name or category",
      "一致する文書がありません",
    ],
    ["資料夾無法存取", "Folder unavailable", "フォルダーにアクセスできません"],
    [
      "{count} 份待處理",
      "{count} files need attention",
      "{count} 件の確認が必要",
    ],
    ["正在處理 {count} 份", "Processing {count} files", "{count} 件を処理中"],
    ["正在檢查…", "Checking…", "確認中…"],
    [
      "自動更新 · {count} 份文件",
      "Auto sync · {count} files",
      "自動更新 · {count} 件",
    ],
    ["上次檢查 {time}", "Last checked {time}", "最終確認 {time}"],
    [
      "{count} 份原檔已移走，保留文件庫副本。",
      "{count} source files moved; library copies kept.",
      "{count} 件の原本が移動されました。コピーは保持しています。",
    ],
    [
      "停止連接（保留文件）",
      "Disconnect (keep files)",
      "接続解除（文書は保持）",
    ],
    [
      "已停止自動更新，文件及原檔保留。",
      "Auto sync stopped. Documents and originals kept.",
      "自動更新を停止しました。文書と原本は残ります。",
    ],
    [
      "連接一個放書籍或論文的資料夾，之後新增 PDF / EPUB 就會自動建立搜尋索引。",
      "Connect your books or papers folder. New PDF / EPUB files will be indexed automatically.",
      "本や論文のフォルダーを接続すると、新しい PDF / EPUB の索引を自動作成します。",
    ],
    [
      "請在 Electron app 內選擇資料夾。",
      "Choose a folder in the desktop app.",
      "デスクトップアプリでフォルダーを選択してください。",
    ],
    [
      "已連接，正在檢查 PDF / EPUB；初次匯入可能需要一點時間。",
      "Connected. Checking PDF / EPUB files; the first import may take a while.",
      "接続しました。PDF / EPUB を確認中です。初回は時間がかかる場合があります。",
    ],
    [
      "已安排檢查；正在複製的檔案會在穩定後匯入。",
      "Check scheduled. Files still being copied will be imported once stable.",
      "確認を予約しました。コピー中のファイルは安定してから取り込みます。",
    ],
    [
      "文件及索引已刪除。",
      "Document and index deleted.",
      "文書と索引を削除しました。",
    ],
    [
      "{name} 已在文件庫中。",
      "{name} is already in the library.",
      "{name} は登録済みです。",
    ],
    [
      "{name} 已加入處理佇列。",
      "{name} added to the import queue.",
      "{name} を取り込み待ちに追加しました。",
    ],
    [
      "選取的文件已在文件庫中。",
      "Selected files are already in the library.",
      "選択したファイルは登録済みです。",
    ],
    [
      "文件已加入處理佇列。",
      "Files added to the import queue.",
      "ファイルを取り込み待ちに追加しました。",
    ],
    ["查看章節原文 ↗", "Open chapter ↗", "章の原文を開く ↗"],
    ["查看 PDF 原頁 ↗", "Open PDF page ↗", "PDF のページを開く ↗"],
    ["檢索資訊", "Retrieval details", "検索の詳細"],
    [
      "向量相似度 {score}，並非答案可信度。",
      "Vector similarity {score}; not answer confidence.",
      "ベクトル類似度 {score}。回答の信頼度ではありません。",
    ],
    ["第 {page} 節", "Section {page}", "第 {page} 節"],
    ["第 {page} 頁", "Page {page}", "{page} ページ"],
    ["正在載入章節…", "Loading chapter…", "章を読み込み中…"],
    ["你", "You", "あなた"],
    ["{count} 個參考段落", "{count} cited passages", "引用箇所 {count} 件"],
    ["{seconds} 秒", "{seconds} s", "{seconds} 秒"],
    ["刪除對話", "Delete conversation", "会話を削除"],
    [
      "請先加入 PDF / EPUB，等候處理完成後再提問。",
      "Select processed documents in this scope before asking.",
      "この範囲で処理済みの文書を選んでから質問してください。",
    ],
    ["正在搜尋文件…", "Searching documents…", "文書を検索中…"],
    [
      "正在閱讀原文並撰寫答案…",
      "Reading sources and writing an answer…",
      "原文を読み、回答を作成中…",
    ],
    [
      "無法開始問答",
      "Could not start the answer",
      "回答を開始できませんでした",
    ],
    [
      "連線提早結束，請重試。",
      "Connection ended early. Please retry.",
      "接続が途中で終了しました。再試行してください。",
    ],
    [
      "已停止生成。未完成的答案不會保存。",
      "Stopped. The incomplete answer was not saved.",
      "生成を停止しました。未完了の回答は保存されません。",
    ],
    ["LM Studio 未連線", "LM Studio offline", "LM Studio 未接続"],
    ["模型尚未準備好", "Model unavailable", "モデルが利用できません"],
    [
      "LM Studio 已連線；首次提問可能需要載入模型",
      "LM Studio connected; the first question may load the model",
      "LM Studio 接続済み。最初の質問時にモデルを読み込む場合があります",
    ],
    [
      "請啟動 LM Studio Local Server",
      "Start the LM Studio Local Server",
      "LM Studio の Local Server を起動してください",
    ],
    [
      "自訂 model identifier…",
      "Custom model identifier…",
      "モデル識別子を直接入力…",
    ],
    [" · 已載入", " · Loaded", " · 読み込み済み"],
    [" · 未載入", " · Not loaded", " · 未読み込み"],
    [
      "找到 {count} 個{kind}模型。清單包含未載入的模型；亦可自行輸入 identifier。",
      "Found {count} models, including unloaded models. You can also enter an identifier.",
      "{count} 個のモデルがあります（未読み込みも含む）。識別子の直接入力も可能です。",
    ],
    [
      "LM Studio 未連線；仍可手動輸入 model identifier 並儲存。",
      "LM Studio is offline. You can still enter and save a model identifier.",
      "LM Studio は未接続です。識別子の入力と保存は可能です。",
    ],
    ["設定已儲存。", "Settings saved.", "設定を保存しました。"],
    [
      "已連線，找到 {count} 個模型。檢查使用已儲存的位址。",
      "Connected: {count} models. Checked the saved address.",
      "接続済み：{count} 個のモデル。保存済みアドレスを確認しました。",
    ],
    [
      "連線失敗。請開啟 LM Studio Local Server，並先儲存正確位址。",
      "Connection failed. Start LM Studio Local Server and save the correct address.",
      "接続に失敗しました。Local Server を起動し、正しいアドレスを保存してください。",
    ],
    [
      "分類名稱需為 1–80 個字。",
      "Use 1–80 characters for the category name.",
      "分類名は 1～80 文字で入力してください。",
    ],
    [
      "此分類名稱已存在。",
      "That category name already exists.",
      "同じ分類名がすでにあります。",
    ],
    [
      "分類已不存在，請重新選擇查詢範圍。",
      "Category removed. Select a new search scope.",
      "分類が削除されています。検索範囲を選び直してください。",
    ],
    [
      "選取的文件已不存在，請重新選擇查詢範圍。",
      "Selected documents no longer exist. Select a new scope.",
      "選択した文書がありません。検索範囲を選び直してください。",
    ],
    [
      "查詢範圍已改變，請建立新對話。",
      "The scope changed. Start a new conversation.",
      "検索範囲が変更されました。新しい会話を開始してください。",
    ],
    [
      "找不到此文件或對話。",
      "Document or conversation not found.",
      "文書または会話が見つかりません。",
    ],
    [
      "上一個回答仍在產生中，請稍候。",
      "An answer is still being generated. Please wait.",
      "前の回答を生成中です。しばらくお待ちください。",
    ],
    [
      "無法取得 embedding。請啟動 LM Studio server 並確認 embedding 模型可用，再重試。",
      "Embedding unavailable. Start LM Studio and check the embedding model, then retry.",
      "埋め込みを取得できません。LM Studio と埋め込みモデルを確認して再試行してください。",
    ],
    [
      "LM Studio 無法連線或回應逾時。請確認 server 和模型已啟動，再重試。",
      "LM Studio could not connect or timed out. Check the server and model, then retry.",
      "LM Studio に接続できないか、時間切れです。サーバーとモデルを確認して再試行してください。",
    ],
  ];
  const translations = new Map(copy.map((row) => [row[0], row]));
  const patterns = copy
    .filter((row) => row[0].includes("{"))
    .map((row) => {
      const keys = [];
      const parts = row[0].split(/(\{\w+\})/).map((part) => {
        if (/^\{\w+\}$/.test(part)) {
          keys.push(part.slice(1, -1));
          return "([\\s\\S]*?)";
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      });
      return { row, keys, regex: new RegExp("^" + parts.join("") + "$") };
    });
  let language = "zh-Hant";
  function t(value, values = {}) {
    if (typeof value !== "string") return value;
    let row = translations.get(value);
    if (!row && language !== "zh-Hant") {
      for (const pattern of patterns) {
        const match = pattern.regex.exec(value);
        if (match) {
          row = pattern.row;
          values = {
            ...Object.fromEntries(
              pattern.keys.map((key, i) => [key, match[i + 1]]),
            ),
            ...values,
          };
          break;
        }
      }
    }
    const text = row
      ? row[language === "en" ? 1 : language === "ja" ? 2 : 0]
      : value;
    return text.replace(/\{(\w+)\}/g, (whole, key) => values[key] ?? whole);
  }
  // Capture static UI once, before document content is rendered. Never walk user content.
  const textNodes = [],
    attributes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.closest("script,style,#language")) continue;
    const original = node.textContent;
    const key = original.trim().replace(/\s+/g, " ");
    if (translations.has(key))
      textNodes.push({
        node,
        key,
        prefix: original.match(/^\s*/)[0],
        suffix: original.match(/\s*$/)[0],
      });
  }
  for (const element of document.querySelectorAll(
    "[title],[placeholder],[aria-label],[data-question]",
  )) {
    for (const attribute of [
      "title",
      "placeholder",
      "aria-label",
      "data-question",
    ]) {
      const key = element.getAttribute(attribute);
      if (key && translations.has(key))
        attributes.push({ element, attribute, key });
    }
  }
  function apply(value) {
    language = ["zh-Hant", "en", "ja"].includes(value) ? value : "zh-Hant";
    document.documentElement.lang = language;
    document.title = t("Local RAG · 私人閱讀室");
    for (const { node, key, prefix, suffix } of textNodes)
      if (node.isConnected) node.textContent = prefix + t(key) + suffix;
    for (const { element, attribute, key } of attributes)
      if (element.isConnected) element.setAttribute(attribute, t(key));
  }
  return { t, apply };
})();
