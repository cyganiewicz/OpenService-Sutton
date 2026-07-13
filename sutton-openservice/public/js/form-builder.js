/**
 * Drag-and-drop reordering for the admin form builder
 * (views/admin/form-builder.ejs). CSP disallows inline handlers, so this
 * is a self-hosted, delegated-listener script — same pattern as
 * confirm-forms.js and rich-editor.js.
 *
 * Markup contract:
 *   <ul class="field-list" data-reorder-url="..." data-csrf="...">
 *     <li class="field-card" draggable="true" data-field-id="...">
 *       <span class="drag-handle">::</span>
 *       ...
 *     </li>
 *   </ul>
 */
(function () {
  "use strict";

  var draggingEl = null;

  function onDragStart(e) {
    draggingEl = e.currentTarget;
    e.dataTransfer.effectAllowed = "move";
    // Firefox requires setData to initiate a drag.
    try {
      e.dataTransfer.setData("text/plain", draggingEl.getAttribute("data-field-id") || "");
    } catch (err) {
      /* ignore */
    }
    draggingEl.classList.add("dragging");
  }

  function onDragEnd() {
    if (draggingEl) draggingEl.classList.remove("dragging");
    draggingEl = null;
  }

  function onDragOver(e) {
    if (!draggingEl) return;
    e.preventDefault();
    var list = e.currentTarget;
    var afterEl = getDragAfterElement(list, e.clientY);
    if (afterEl == null) {
      list.appendChild(draggingEl);
    } else {
      list.insertBefore(draggingEl, afterEl);
    }
  }

  function getDragAfterElement(list, y) {
    var cards = Array.prototype.slice.call(list.querySelectorAll(".field-card:not(.dragging)"));
    var closest = { offset: -Infinity, element: null };
    cards.forEach(function (card) {
      var box = card.getBoundingClientRect();
      var offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        closest = { offset: offset, element: card };
      }
    });
    return closest.element;
  }

  function onDrop(e) {
    if (!draggingEl) return;
    e.preventDefault();
    var list = e.currentTarget;
    persistOrder(list);
  }

  function persistOrder(list) {
    var url = list.getAttribute("data-reorder-url");
    var csrf = list.getAttribute("data-csrf");
    if (!url) return;
    var ids = Array.prototype.slice
      .call(list.querySelectorAll(".field-card"))
      .map(function (card) {
        return card.getAttribute("data-field-id");
      });
    var status = document.querySelector('[data-reorder-status]');
    if (status) {
      status.textContent = "Saving order…";
      status.className = "hint";
    }
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _csrf: csrf, order: ids }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("Request failed");
        return res.json();
      })
      .then(function () {
        if (status) {
          status.textContent = "Order saved.";
          status.className = "hint text-success-strong";
        }
      })
      .catch(function () {
        if (status) {
          status.textContent = "Couldn't save the new order — reload and try again.";
          status.className = "hint field-error";
        }
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var lists = document.querySelectorAll(".field-list");
    lists.forEach(function (list) {
      list.addEventListener("dragover", onDragOver);
      list.addEventListener("drop", onDrop);
      list.querySelectorAll(".field-card").forEach(function (card) {
        card.addEventListener("dragstart", onDragStart);
        card.addEventListener("dragend", onDragEnd);
      });
    });
  });
})();
