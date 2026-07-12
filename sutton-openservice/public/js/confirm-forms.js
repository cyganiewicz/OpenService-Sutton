// Progressive-enhancement confirm() for destructive forms (delete vacancy,
// delete board, delete seat, reset staff password, etc). Replaces
// onsubmit="return confirm(...)" attributes, which are inline event handlers
// and get silently dropped under this site's CSP (script-src 'self', no
// 'unsafe-inline'). Any <form data-confirm="message text"> gets this
// behavior automatically.
document.addEventListener("submit", function (event) {
  var form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  var message = form.getAttribute("data-confirm");
  if (!message) return;
  if (!window.confirm(message)) {
    event.preventDefault();
  }
});
