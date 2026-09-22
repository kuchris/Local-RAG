const $ = (selector) => document.querySelector(selector);
const t = I18n.t;
const state = {
  documents: [],
  folders: [],
  categories: [],
  scope: { category_id: null, document_ids: null, reading_mode: "standard" },
  language: "zh-Hant",
  conversation: null,
  sources: [],
  busy: false,
  settings: null,
  controller: null,
};
let toastTimer;
let preferenceWrite = Promise.resolve();
function saveScope() {
  const scope = structuredClone(state.scope);
  preferenceWrite = preferenceWrite
    .catch(() => {})
    .then(() => api("/preferences", { method: "PATCH", body: { scope } }));
  return preferenceWrite;
}
function toast(message) {
  $("#toast").textContent = t(message);
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 5500);
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
async function api(url, options = {}) {
  if (options.body && !(options.body instanceof FormData)) {
    options.body = JSON.stringify(options.body);
    options.headers = { "Content-Type": "application/json" };
  }
  const response = await fetch("/api" + url, options);
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : t("設定或請求格式不正確。"),
    );
  return data;
}
function report(error) {
  toast(error.message || String(error));
}
function setScope(id) {
  changeScope({
    category_id: id ? state.scope.category_id : null,
    document_ids: id ? [id] : null,
  });
}
function categoryDocuments() {
  const id = state.scope.category_id;
  return state.documents.filter(
    (d) =>
      !id ||
      (id === "__uncategorized__" ? !d.category_id : d.category_id === id),
  );
}
function scopedDocuments() {
  return categoryDocuments().filter(
    (d) =>
      state.scope.document_ids === null ||
      state.scope.document_ids.includes(d.id),
  );
}
function updateScopeLabel() {
  const ids = state.scope.document_ids;
  const name =
    ids !== null
      ? ids.length === 1
        ? state.documents.find((d) => d.id === ids[0])?.name ||
          t("文件已不存在")
        : t("已選 {count} 份文件", { count: ids.length })
      : state.scope.category_id === "__uncategorized__"
        ? t("未分類")
        : state.scope.category_id
          ? state.categories.find((c) => c.id === state.scope.category_id)
              ?.name || t("分類已不存在")
          : t("所有文件");
  $("#scope-name").textContent = name;
  $("#composer-scope").textContent = name;
  $("#all-docs").classList.toggle(
    "active",
    ids === null && !state.scope.category_id,
  );
  $("#category-scope").value = state.scope.category_id || "";
  $("#reading-mode").value = state.scope.reading_mode;
  $("#fiction-note").hidden = state.scope.reading_mode !== "fiction";
  $("#selection-actions").hidden = !ids?.length;
  $("#selection-count").textContent = t("已選 {count} 份文件", {
    count: ids?.length || 0,
  });
}
function changeScope(values) {
  if (state.busy) {
    updateScopeLabel();
    return toast(t("請先等候回答完成或停止生成。"));
  }
  state.scope = { ...state.scope, ...values };
  if (state.conversation) newChat();
  updateScopeLabel();
  renderDocuments();
  saveScope().catch(report);
}
function renderDocuments() {
  $("#doc-count").textContent = state.documents.length;
  const list = $("#documents");
  list.replaceChildren();
  for (const doc of categoryDocuments()) {
    if (
      !doc.name
        .toLocaleLowerCase()
        .includes($("#document-search").value.toLocaleLowerCase())
    )
      continue;
    const row = el(
      "div",
      "document" +
        (state.scope.document_ids?.includes(doc.id) ? " selected" : ""),
    );
    const checkbox = el("input", "document-check");
    checkbox.type = "checkbox";
    checkbox.disabled = state.busy;
    checkbox.checked = state.scope.document_ids?.includes(doc.id) || false;
    checkbox.setAttribute("aria-label", t("選擇 {name}", { name: doc.name }));
    checkbox.onchange = () => {
      const ids = new Set(state.scope.document_ids || []);
      if (checkbox.checked) ids.add(doc.id);
      else ids.delete(doc.id);
      changeScope({ document_ids: [...ids] });
    };
    row.append(checkbox);
    row.append(el("span", "file-icon", (doc.format || "pdf").toUpperCase()));
    const select = el("button", "document-select");
    select.title = doc.name;
    select.disabled = doc.status !== "ready";
    select.append(el("span", "doc-name", doc.name));
    const meta =
      doc.status === "ready"
        ? t(
            `${doc.pages} ${doc.format === "epub" ? "節" : "頁"} · ${doc.chunks} 個段落`,
          )
        : doc.status === "error"
          ? t("處理失敗")
          : t(doc.error) || t(`正在處理 · ${doc.progress}%`);
    select.append(el("span", "doc-meta", meta));
    if (doc.category_id)
      select.append(
        el(
          "span",
          "doc-category",
          state.categories.find((c) => c.id === doc.category_id)?.name || "",
        ),
      );
    select.onclick = () => setScope(doc.id);
    row.append(select);
    if (doc.status === "queued" || doc.status === "processing") {
      const progress = el("progress", "progress");
      progress.max = 100;
      progress.value = doc.progress;
      select.append(progress);
    }
    if (doc.status === "error") {
      select.title = t(doc.error);
      const retry = el("button", "retry", t("重試"));
      retry.onclick = () =>
        api(`/documents/${doc.id}/retry`, { method: "POST" })
          .then(refreshDocuments)
          .catch(report);
      const container = el("div");
      container.append(el("div", "doc-meta doc-error", t(doc.error)), retry);
      row.append(container);
    }
    if (!["queued", "processing"].includes(doc.status)) {
      const remove = el("button", "doc-delete", "×");
      remove.title = t("刪除文件");
      remove.setAttribute("aria-label", t(`刪除 ${doc.name}`));
      remove.onclick = () => confirmDelete(doc);
      row.append(remove);
    }
    list.append(row);
  }
  if (!state.documents.length)
    list.append(el("p", "muted tiny", t("連接資料夾，讓文件自動加入")));
  else if (!list.children.length)
    list.append(el("p", "muted tiny", t("沒有符合名稱的文件")));
}
$("#document-search").oninput = renderDocuments;
$("#category-scope").onchange = (event) =>
  changeScope({ category_id: event.target.value || null, document_ids: null });
$("#reading-mode").onchange = (event) =>
  changeScope({ reading_mode: event.target.value });
$("#select-visible").onclick = () =>
  changeScope({
    document_ids: categoryDocuments()
      .filter((d) =>
        d.name
          .toLocaleLowerCase()
          .includes($("#document-search").value.toLocaleLowerCase()),
      )
      .map((d) => d.id),
  });
$("#clear-selection").onclick = () => changeScope({ document_ids: [] });
function renderCategories() {
  const picker = $("#category-scope"),
    assign = $("#assign-category");
  const target = assign.value;
  const option = (id, name) => {
    const node = el("option", "", name);
    node.value = id;
    return node;
  };
  picker.replaceChildren(
    option("", t("所有分類")),
    option("__uncategorized__", t("未分類")),
    ...state.categories.map((c) => option(c.id, `${c.name} (${c.count})`)),
  );
  if (
    state.scope.category_id &&
    ![...picker.options].some((o) => o.value === state.scope.category_id)
  )
    picker.append(option(state.scope.category_id, t("分類已不存在")));
  assign.replaceChildren(
    option("", t("未分類")),
    ...state.categories.map((c) => option(c.id, c.name)),
  );
  if ([...assign.options].some((o) => o.value === target))
    assign.value = target;
  const list = $("#category-list");
  list.replaceChildren();
  for (const category of state.categories) {
    const row = el("form", "category-row");
    const input = el("input");
    input.value = category.name;
    input.required = true;
    input.maxLength = 80;
    input.setAttribute("aria-label", t("分類名稱"));
    const save = el("button", "secondary", t("重新命名"));
    save.type = "submit";
    const remove = el("button", "secondary", t("移除"));
    remove.type = "button";
    row.onsubmit = async (event) => {
      event.preventDefault();
      try {
        await api(`/categories/${category.id}`, {
          method: "PUT",
          body: { name: input.value },
        });
        await refreshCategories();
      } catch (error) {
        report(error);
      }
    };
    remove.onclick = async () => {
      if (state.busy) return report(t("請先等候回答完成或停止生成。"));
      try {
        await api(`/categories/${category.id}`, { method: "DELETE" });
        await refreshCategories();
        await refreshDocuments();
        if (state.scope.category_id === category.id)
          changeScope({ category_id: "__uncategorized__", document_ids: null });
      } catch (error) {
        report(error);
      }
    };
    row.append(input, save, remove);
    list.append(row);
  }
  updateScopeLabel();
}
async function refreshCategories() {
  state.categories = await api("/categories");
  renderCategories();
  renderDocuments();
}
$("#manage-categories").onclick = () => {
  $("#categories-dialog").showModal();
};
$("#category-form").onsubmit = async (event) => {
  event.preventDefault();
  try {
    await api("/categories", {
      method: "POST",
      body: { name: event.target.elements.name.value },
    });
    event.target.reset();
    await refreshCategories();
  } catch (error) {
    report(error);
  }
};
$("#apply-category").onclick = async () => {
  if (state.busy) return report(t("請先等候回答完成或停止生成。"));
  if (!state.scope.document_ids?.length) return toast(t("請先勾選文件。"));
  try {
    const category = $("#assign-category").value;
    await api("/document-categories", {
      method: "PUT",
      body: {
        document_ids: state.scope.document_ids,
        category_id: category || null,
      },
    });
    await refreshCategories();
    await refreshDocuments();
    changeScope({ category_id: category || "__uncategorized__" });
    toast(t("分類已更新。"));
  } catch (error) {
    report(error);
  }
};
$("#language").onchange = async (event) => {
  if (state.busy) {
    event.target.value = state.language;
    return toast(t("請先等候回答完成或停止生成。"));
  }
  try {
    await api("/preferences", {
      method: "PATCH",
      body: { language: event.target.value },
    });
    setLanguage(event.target.value);
  } catch (error) {
    event.target.value = state.language;
    report(error);
  }
};
function setLanguage(language) {
  $("#toast").hidden = true;
  state.language = language;
  I18n.apply(language);
  $("#language").value = language;
  renderCategories();
  renderDocuments();
  renderFolders();
  renderSources(state.sources);
  refreshConversations().catch(report);
  document.querySelectorAll(".message .role").forEach((node) => {
    if (node.closest(".user")) {
      node.firstChild.textContent = t("你");
      node.lastChild.textContent = t("你");
    }
  });
  document.querySelectorAll(".message-footer button").forEach((node) => {
    node.textContent = t("{count} 個參考段落", { count: node.dataset.count });
  });
  document.querySelectorAll("[data-elapsed]").forEach((node) => {
    node.textContent = t("{seconds} 秒", { seconds: node.dataset.elapsed });
  });
  if (state.settings) refreshModels().catch(report);
}

function renderFolders() {
  const compact = $("#folders"),
    details = $("#folder-details");
  compact.replaceChildren();
  details.replaceChildren();
  for (const folder of state.folders) {
    const errors = folder.files.filter((f) => f.error || f.status === "error");
    const pending = folder.files.filter((f) =>
      ["queued", "processing"].includes(f.status),
    );
    const count = folder.files.filter((f) => f.document_id).length;
    const missing = folder.files.filter((f) => !f.present).length;
    const status = folder.error
      ? t("資料夾無法存取")
      : errors.length
        ? t(`${errors.length} 份待處理`)
        : pending.length
          ? t(`正在處理 ${pending.length} 份`)
          : folder.scanning
            ? t("正在檢查…")
            : t(`自動更新 · ${count} 份文件`);
    const name = folder.path.split(/[\\/]/).filter(Boolean).pop();
    const button = el("button", "folder-summary");
    button.title = folder.path;
    button.append(el("span", "", `▱ ${name}`), el("small", "", status));
    button.onclick = () => $("#folders-dialog").showModal();
    compact.append(button);
    const card = el("section", "folder-detail");
    card.append(
      el("h3", "", name),
      el("p", "folder-path", folder.path),
      el("p", "", status),
    );
    if (folder.last_scan)
      card.append(
        el(
          "p",
          "muted tiny",
          t(
            `上次檢查 ${new Date(folder.last_scan * 1000).toLocaleTimeString()}`,
          ),
        ),
      );
    if (folder.error) card.append(el("p", "doc-error", t(folder.error)));
    if (missing)
      card.append(
        el("p", "muted tiny", t(`${missing} 份原檔已移走，保留文件庫副本。`)),
      );
    for (const file of errors) {
      const error = el("div", "folder-file-error");
      error.append(
        el(
          "p",
          "doc-error",
          `${file.path}：${t(file.error || file.import_error)}`,
        ),
      );
      const id = file.pending_id || file.document_id;
      if (file.status === "error" && id) {
        const retry = el("button", "retry", t("重試"));
        retry.onclick = () =>
          api(`/documents/${id}/retry`, { method: "POST" })
            .then(refreshFolders)
            .catch(report);
        error.append(retry);
      }
      card.append(error);
    }
    const remove = el("button", "secondary", t("停止連接（保留文件）"));
    remove.onclick = async () => {
      try {
        await api(`/folders/${folder.id}`, { method: "DELETE" });
        await refreshFolders();
        toast(t("已停止自動更新，文件及原檔保留。"));
      } catch (error) {
        report(error);
      }
    };
    card.append(remove);
    details.append(card);
  }
  if (!state.folders.length)
    details.append(
      el(
        "p",
        "muted",
        t(
          "連接一個放書籍或論文的資料夾，之後新增 PDF / EPUB 就會自動建立搜尋索引。",
        ),
      ),
    );
}
async function refreshFolders() {
  const folders = await api("/folders");
  if (JSON.stringify(folders) !== JSON.stringify(state.folders)) {
    state.folders = folders;
    renderFolders();
  }
}
async function connectFolder() {
  if (!window.desktop) return toast(t("請在 Electron app 內選擇資料夾。"));
  try {
    const result = await window.desktop.chooseFolder(state.language);
    if (!result) return;
    toast(t("已連接，正在檢查 PDF / EPUB；初次匯入可能需要一點時間。"));
    await refreshFolders();
  } catch (error) {
    report(error);
  }
}
$("#connect-folder").onclick = connectFolder;
$("#add-folder").onclick = connectFolder;
$("#manage-folders").onclick = () => {
  renderFolders();
  $("#folders-dialog").showModal();
};
$("#scan-folders").onclick = async () => {
  try {
    await api("/folders/scan", { method: "POST" });
    toast(t("已安排檢查；正在複製的檔案會在穩定後匯入。"));
  } catch (error) {
    report(error);
  }
};
async function refreshDocuments() {
  const documents = await api("/documents");
  if (JSON.stringify(documents) !== JSON.stringify(state.documents)) {
    state.documents = documents;
    updateScopeLabel();
    renderDocuments();
    await refreshCategories();
  }
}
async function confirmDelete(doc) {
  if (state.busy) return toast(t("請先等候回答完成或停止生成。"));
  $("#confirm-name").textContent = doc.name;
  $("#confirm-dialog").showModal();
  $("#confirm-delete").onclick = async () => {
    try {
      await api(`/documents/${doc.id}`, { method: "DELETE" });
      $("#confirm-dialog").close();
      await refreshDocuments();
      renderSources(state.sources.filter((s) => s.document_id !== doc.id));
      if (state.conversation) await loadConversation(state.conversation);
      toast(t("文件及索引已刪除。"));
    } catch (error) {
      report(error);
    }
  };
}
$("#cancel-delete").onclick = () => $("#confirm-dialog").close();

async function upload(files) {
  for (const file of files) {
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api("/documents", { method: "POST", body: form });
      toast(
        result.duplicate
          ? t(`${file.name} 已在文件庫中。`)
          : t(`${file.name} 已加入處理佇列。`),
      );
      await refreshDocuments();
    } catch (error) {
      report(error);
    }
  }
}
$("#import").onclick = async () => {
  if (!window.desktop) return $("#file-input").click();
  try {
    const results = await window.desktop.chooseDocuments(state.language);
    if (results.length)
      toast(
        results.every((r) => r.duplicate)
          ? t("選取的文件已在文件庫中。")
          : t("文件已加入處理佇列。"),
      );
    await refreshDocuments();
  } catch (error) {
    report(error);
  }
};
$("#file-input").onchange = async (event) => {
  await upload(event.target.files);
  event.target.value = "";
};
let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  event.preventDefault();
  if (event.dataTransfer.types.includes("Files")) {
    dragDepth++;
    $("#drop-overlay").hidden = false;
  }
});
document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("dragleave", (event) => {
  event.preventDefault();
  if (--dragDepth <= 0) $("#drop-overlay").hidden = true;
});
document.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  $("#drop-overlay").hidden = true;
  upload(event.dataTransfer.files);
});
$("#all-docs").onclick = () => setScope(null);

function renderSources(sources) {
  state.sources = sources;
  $("#source-count").textContent = sources.length;
  const parent = $("#sources");
  parent.replaceChildren();
  if (!sources.length) {
    const empty = el("div", "source-empty");
    empty.append(
      el("h3", "", t("每個答案，都有出處")),
      el(
        "p",
        "",
        t(
          "提問後，相關段落會顯示在這裡。\n點擊引用，即可查看 PDF 原頁或 EPUB 章節。",
        ),
      ),
    );
    parent.append(empty);
    return;
  }
  for (const source of sources) {
    const card = el("article", "source-card");
    card.id = `source-${source.id}`;
    const top = el("div", "source-top");
    top.append(
      el("span", "source-number", `[${source.id}]`),
      el("span", "source-page", sourceLocation(source)),
    );
    const open = el(
      "button",
      "",
      source.format === "epub" ? t("查看章節原文 ↗") : t("查看 PDF 原頁 ↗"),
    );
    open.onclick = () => openPDF(source);
    const details = el("details");
    details.append(
      el("summary", "", t("檢索資訊")),
      el("p", "", t(`向量相似度 ${source.score}，並非答案可信度。`)),
    );
    card.append(
      top,
      el("h4", "", source.name),
      el("p", "", source.text),
      open,
      details,
    );
    parent.append(card);
  }
}
function sourceLocation(source) {
  return source.format === "epub"
    ? source.location || t(`第 ${source.page} 節`)
    : t(`第 ${source.page} 頁`);
}
let sourceRequest = 0;
async function openPDF(source) {
  const request = ++sourceRequest;
  $("#pdf-title").textContent = `${source.name} · ${sourceLocation(source)}`;
  $("#pdf-viewer").removeAttribute("src");
  const epub = source.format === "epub";
  $("#pdf-viewer").hidden = epub;
  $("#epub-viewer").hidden = !epub;
  $("#pdf-dialog").showModal();
  if (epub) {
    $("#epub-text").textContent = t("正在載入章節…");
    try {
      const section = await api(
        `/documents/${source.document_id}/sections/${source.page}`,
      );
      if (request === sourceRequest) $("#epub-text").textContent = section.text;
    } catch (error) {
      if (request === sourceRequest)
        $("#epub-text").textContent = t(error.message);
    }
  } else
    $("#pdf-viewer").src =
      `/api/documents/${source.document_id}/pdf#page=${source.page}`;
}
function renderAnswer(node, text, sources) {
  // Parse formatting, then allow only inert text markup before adding our buttons.
  const html = marked.parse(text, { breaks: true });
  node.innerHTML = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "em",
      "ul",
      "ol",
      "li",
      "code",
      "pre",
      "blockquote",
      "h1",
      "h2",
      "h3",
      "h4",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    ALLOWED_ATTR: [],
  });
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const original of texts) {
    const fragment = document.createDocumentFragment();
    for (const part of original.textContent.split(/(\[\d+\])/g)) {
      const match = /^\[(\d+)\]$/.exec(part);
      const source = match && sources.find((s) => s.id === Number(match[1]));
      if (source) {
        const button = el("button", "citation", part);
        button.title = `${source.name} · ${sourceLocation(source)}`;
        button.onclick = () => {
          renderSources(sources);
          const card = $(`#source-${source.id}`);
          card.classList.add("highlight");
          card.scrollIntoView({ block: "nearest" });
          openPDF(source);
        };
        fragment.append(button);
      } else fragment.append(document.createTextNode(part));
    }
    original.replaceWith(fragment);
  }
  renderMathInElement(node, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
    ],
    throwOnError: false,
    trust: false,
    maxExpand: 1000,
  });
}
function addMessage(role, text, sources = []) {
  $("#welcome").hidden = true;
  const message = el("article", `message ${role}`);
  const label = el("div", "role");
  label.append(
    el("span", "avatar", role === "user" ? t("你") : "lr"),
    el("span", "", role === "user" ? t("你") : "LOCAL RAG"),
  );
  const content = el("div", "message-content");
  renderAnswer(content, text, sources);
  message.append(label, content);
  $("#messages").append(message);
  return { message, content };
}
function scrollBottom() {
  const panel = $("#chat-scroll");
  panel.scrollTop = panel.scrollHeight;
}
function finishMessage(message, sources, elapsed) {
  const footer = el("div", "message-footer");
  const show = el("button", "", t(`${sources.length} 個參考段落`));
  show.dataset.count = sources.length;
  show.onclick = () => renderSources(sources);
  footer.append(show);
  if (elapsed) {
    const timing = el("span", "", t(`${elapsed.toFixed(1)} 秒`));
    timing.dataset.elapsed = elapsed.toFixed(1);
    footer.append(timing);
  }
  message.append(footer);
}
function newChat() {
  if (state.busy) return toast(t("請先等候回答完成或停止生成。"));
  state.conversation = null;
  $("#messages").replaceChildren();
  $("#welcome").hidden = false;
  renderSources([]);
  $("#question").focus();
  refreshConversations();
}
$("#new-chat").onclick = newChat;
async function refreshConversations() {
  const conversations = await api("/conversations");
  const list = $("#conversations");
  list.replaceChildren();
  for (const conversation of conversations) {
    const row = el(
      "div",
      "conversation" +
        (state.conversation === conversation.id ? " current" : ""),
    );
    const button = el("button", "", "↳  " + conversation.title);
    button.title = conversation.title;
    button.onclick = () => loadConversation(conversation.id).catch(report);
    const remove = el("button", "remove-chat", "×");
    remove.setAttribute("aria-label", t("刪除對話"));
    remove.onclick = async () => {
      if (state.busy) return;
      try {
        await api(`/conversations/${conversation.id}`, { method: "DELETE" });
        if (state.conversation === conversation.id) newChat();
        await refreshConversations();
      } catch (error) {
        report(error);
      }
    };
    row.append(button, remove);
    list.append(row);
  }
  if (!conversations.length)
    list.append(el("p", "muted tiny", t("對話會保存在這部電腦")));
}
async function loadConversation(id) {
  if (state.busy) return toast(t("請先等候回答完成或停止生成。"));
  const history = await api(`/conversations/${id}`);
  state.scope = await api(`/conversations/${id}/scope`);
  updateScopeLabel();
  renderCategories();
  renderDocuments();
  await saveScope();
  state.conversation = id;
  $("#messages").replaceChildren();
  $("#welcome").hidden = true;
  renderSources([]);
  for (const item of history) {
    const rendered = addMessage(item.role, item.content, item.sources);
    if (item.role === "assistant") {
      finishMessage(rendered.message, item.sources);
      renderSources(item.sources);
    }
  }
  await refreshConversations();
  scrollBottom();
}
function setBusy(busy) {
  state.busy = busy;
  document
    .querySelectorAll(
      "#language, #reading-mode, #category-scope, .document-check, #select-visible, #clear-selection, #apply-category",
    )
    .forEach((node) => (node.disabled = busy));
  $("#send").hidden = busy;
  $("#stop").hidden = !busy;
  $("#question").disabled = busy;
  $("#working").hidden = !busy;
}
$("#composer").onsubmit = async (event) => {
  event.preventDefault();
  if (state.busy) return;
  const question = $("#question").value.trim();
  if (!question) return;
  if (!scopedDocuments().some((d) => d.status === "ready"))
    return toast(t("目前範圍沒有已完成處理的文件，請重新選擇。"));
  $("#question").value = "";
  addMessage("user", question);
  const assistant = addMessage("assistant", "");
  setBusy(true);
  $("#working").textContent = t("正在搜尋文件…");
  state.controller = new AbortController();
  scrollBottom();
  let answer = "",
    sources = [],
    finished = false;
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: state.controller.signal,
      body: JSON.stringify({
        question,
        ...state.scope,
        language: state.language,
        conversation_id: state.conversation,
      }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || t("無法開始問答"));
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "status")
          $("#working").textContent = t(event.message);
        if (event.type === "sources") {
          sources = event.sources;
          state.conversation = event.conversation_id;
          renderSources(sources);
          refreshConversations().catch(report);
        }
        if (event.type === "delta") {
          answer += event.text;
          renderAnswer(assistant.content, answer, sources);
          scrollBottom();
        }
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "done") {
          finished = true;
          finishMessage(assistant.message, sources, event.elapsed);
        }
      }
    }
    if (!finished) throw new Error(t("連線提早結束，請重試。"));
  } catch (error) {
    assistant.message.classList.add("error");
    const notice =
      error.name === "AbortError"
        ? t("已停止生成。未完成的答案不會保存。")
        : t(error.message);
    assistant.content.append(
      document.createTextNode((answer ? "\n\n" : "") + notice),
    );
  } finally {
    setBusy(false);
    state.controller = null;
    $("#question").focus();
    refreshConversations().catch(report);
  }
};
$("#stop").onclick = () => state.controller?.abort();
$("#question").onkeydown = (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("#composer").requestSubmit();
  }
};
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "n") {
    event.preventDefault();
    newChat();
  }
});
document.querySelectorAll("[data-question]").forEach(
  (button) =>
    (button.onclick = () => {
      $("#question").value = button.dataset.question;
      $("#question").focus();
    }),
);

async function refreshModels() {
  const result = await api("/models");
  const status = $("#model-status");
  status.classList.toggle(
    "online",
    result.online && result.configured_available,
  );
  status.querySelector("span").textContent = !result.online
    ? t("LM Studio 未連線")
    : !result.configured_available
      ? t("模型尚未準備好")
      : state.settings.model;
  status.title = result.online
    ? t("LM Studio 已連線；首次提問可能需要載入模型")
    : t("請啟動 LM Studio Local Server");
  const catalog =
    result.catalog ||
    result.models.map((id) => ({
      id,
      name: id,
      type: "unknown",
      loaded: null,
    }));
  const answers = catalog.filter((model) => model.type !== "embedding");
  const custom = el("option", "", t("自訂 model identifier…"));
  custom.value = "__custom__";
  $("#answer-model-picker").replaceChildren(
    ...answers.map((model) => {
      const option = el("option");
      option.value = model.id;
      option.textContent =
        model.id +
        (model.loaded === true
          ? t(" · 已載入")
          : model.loaded === false
            ? t(" · 未載入")
            : "");
      return option;
    }),
    custom,
  );
  syncModelPicker();
  $("#model-picker-help").textContent = result.online
    ? t(
        `找到 ${answers.length} 個${catalog.some((m) => m.type !== "unknown") ? "回答" : "可用"}模型。清單包含未載入的模型；亦可自行輸入 identifier。`,
      )
    : t("LM Studio 未連線；仍可手動輸入 model identifier 並儲存。");
  return result;
}
function syncModelPicker() {
  const picker = $("#answer-model-picker");
  const value = $('#settings-form input[name="model"]').value;
  picker.value = [...picker.options].some((option) => option.value === value)
    ? value
    : "__custom__";
}
$('#settings-form input[name="model"]').oninput = syncModelPicker;
$("#answer-model-picker").onchange = (event) => {
  const input = $('#settings-form input[name="model"]');
  if (event.target.value === "__custom__") {
    input.focus();
    input.select();
  } else input.value = event.target.value;
};
async function openSettings() {
  state.settings = await api("/settings");
  const form = $("#settings-form");
  for (const [key, value] of Object.entries(state.settings))
    if (form.elements.namedItem(key))
      form.elements.namedItem(key).value = value;
  $("#data-dir").textContent = (await api("/health")).data_dir;
  $("#settings-feedback").textContent = "";
  $("#settings-dialog").showModal();
  syncModelPicker();
  refreshModels().catch(report);
}
$("#settings-button").onclick = () => openSettings().catch(report);
$("#model-status").onclick = () => openSettings().catch(report);
$("#settings-form").onsubmit = async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  data.embedding_idle_unload = data.embedding_idle_unload === "true";
  for (const key of ["top_k", "max_tokens", "temperature"])
    data[key] = Number(data[key]);
  try {
    state.settings = await api("/settings", { method: "PUT", body: data });
    await refreshModels();
    $("#settings-dialog").close();
    toast(t("設定已儲存。"));
  } catch (error) {
    $("#settings-feedback").textContent = t(error.message);
  }
};
$("#check-models").onclick = async () => {
  try {
    const result = await refreshModels();
    $("#settings-feedback").textContent = result.online
      ? t(`已連線，找到 ${result.models.length} 個模型。檢查使用已儲存的位址。`)
      : t("連線失敗。請開啟 LM Studio Local Server，並先儲存正確位址。");
  } catch (error) {
    report(error);
  }
};
document
  .querySelectorAll(".close-dialog")
  .forEach(
    (button) => (button.onclick = () => button.closest("dialog").close()),
  );
$("#pdf-dialog").addEventListener("close", () => {
  ++sourceRequest;
  $("#pdf-viewer").removeAttribute("src");
  $("#epub-text").textContent = "";
});
async function initialize() {
  const preferences = await api("/preferences");
  state.scope = {
    category_id: null,
    document_ids: null,
    reading_mode: "standard",
    ...preferences.scope,
  };
  state.language = preferences.language;
  I18n.apply(state.language);
  $("#language").value = state.language;
  state.settings = await api("/settings");
  await Promise.all([
    refreshDocuments(),
    refreshConversations(),
    refreshModels(),
    refreshFolders(),
    refreshCategories(),
  ]);
}
initialize().catch(report);
setInterval(() => refreshDocuments().catch(() => {}), 1800);
setInterval(() => refreshFolders().catch(() => {}), 2500);
setInterval(() => refreshModels().catch(() => {}), 15000);
