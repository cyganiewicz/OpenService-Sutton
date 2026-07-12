window.addEventListener("DOMContentLoaded", function () {
  var box = document.querySelector(".test-box");
  var result = document.getElementById("result");
  var varValue = getComputedStyle(document.documentElement).getPropertyValue("--test-navy").trim();
  var bgColor = box ? getComputedStyle(box).backgroundColor : "(no .test-box found)";
  result.textContent =
    "--test-navy resolves to: \"" + (varValue || "(EMPTY)") + "\"\n" +
    ".test-box computed background-color: " + bgColor + "\n" +
    "(expected: --test-navy = \"#12251a\", background-color = \"rgb(18, 37, 26)\")";
});
