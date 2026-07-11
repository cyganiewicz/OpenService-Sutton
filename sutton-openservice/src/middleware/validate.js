const { validationResult } = require("express-validator");

/**
 * Runs after express-validator check chains. On failure, re-renders the
 * same form with field-level errors and the user's prior input (except
 * files/passwords) so nothing typed is lost.
 */
function handleValidation(viewName, extraLocals = {}) {
  return (req, res, next) => {
    const errors = validationResult(req);
    if (errors.isEmpty()) return next();
    return res.status(422).render(viewName, {
      errors: errors.mapped(),
      values: req.body,
      ...extraLocals,
    });
  };
}

module.exports = { handleValidation };
