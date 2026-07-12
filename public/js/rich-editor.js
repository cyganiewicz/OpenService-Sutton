/**
 * Minimal, self-hosted rich text editor (no CDN dependency, so it doesn't
 * require loosening the site's Content-Security-Policy). Progressively
 * enhances a <textarea data-rte> into a toolbar + contenteditable surface;
 * if JavaScript is disabled the plain textarea still works and submits.
 *
 * Server-side, the resulting HTML is sanitized with sanitize-html before
 * being saved (see src/utils/richText.js) — never trust this editor's
 * output as the security boundary, it's a UX layer only.
 */
(function () {
  function buildToolbar(onCommand) {
    var bar = document.createElement("div");
    bar.className = "rte-toolbar";
    var buttons = [
      { cmd: "bold", label: "B", title: "Bold" },
      { cmd: "italic", label: "I", title: "Italic" },
      { cmd: "underline", label: "U", title: "Underline" },
      { cmd: "insertUnorderedList", label: "• List", title: "Bulleted list" },
      { cmd: "insertOrderedList", label: "1. List", title: "Numbered list" },
      { cmd: "link", label: "Link", title: "Insert link" },
      { cmd: "removeFormat", label: "Clear", title: "Clear formatting" },
    ];
    buttons.forEach(function (b) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rte-btn";
      btn.textContent = b.label;
      btn.title = b.title;
      btn.setAttribute("aria-label", b.title);
      btn.addEventListener("click", function () {
        onCommand(b.cmd);
      });
      bar.appendChild(btn);
    });
    return bar;
  }

  function init(textarea) {
    var wrap = document.createElement("div");
    wrap.className = "rte-wrap";

    var editable = document.createElement("div");
    editable.className = "rte-editable";
    editable.contentEditable = "true";
    editable.innerHTML = textarea.value || "";
    editable.setAttribute("role", "textbox");
    editable.setAttribute("aria-multiline", "true");
    if (textarea.id) editable.setAttribute("aria-labelledby", textarea.id + "-label");

    function sync() {
      textarea.value = editable.innerHTML.trim();
    }

    var toolbar = buildToolbar(function (cmd) {
      editable.focus();
      if (cmd === "link") {
        var url = window.prompt("Link URL (https://...)");
        if (url) document.execCommand("createLink", false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
      sync();
    });

    editable.addEventListener("input", sync);
    editable.addEventListener("blur", sync);

    wrap.appendChild(toolbar);
    wrap.appendChild(editable);

    textarea.style.display = "none";
    textarea.setAttribute("aria-hidden", "true");
    textarea.parentNode.insertBefore(wrap, textarea);

    // Belt-and-suspenders: make sure the textarea (what actually submits)
    // is current right before the form posts, even if blur didn't fire.
    var form = textarea.closest("form");
    if (form) form.addEventListener("submit", sync);
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("textarea[data-rte]").forEach(init);
  });
})();
