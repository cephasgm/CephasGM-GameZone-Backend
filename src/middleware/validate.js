/**
 * ============================================================
 * CephasGM GameZone — Request Validator
 * ============================================================
 * Runs a Zod schema against req.body / req.query / req.params,
 * returns a clean 422 with field-level errors if invalid,
 * otherwise replaces the request property with the parsed
 * (and type-coerced) value so downstream handlers get clean data.
 *
 * Usage:
 *   router.post('/login', validate({ body: loginSchema }), login);
 *
 *   // Or single-target shorthand:
 *   router.post('/register', validate(registerSchema), register); // defaults to body
 * ============================================================
 */

'use strict';

const { ZodError } = require('zod');
const { AppError } = require('../utils/AppError');

/* ------------------------------------------------------------
   Turn a ZodError into a flat, frontend-friendly list
   ------------------------------------------------------------ */
function formatZodIssues(zodError) {
  return zodError.issues.map((issue) => ({
    field: issue.path.join('.') || '_root',
    message: issue.message,
    code: issue.code,
  }));
}

/* ------------------------------------------------------------
   Main middleware factory
   ------------------------------------------------------------ */
function validate(schemasOrSingle) {
  // Support both validate(schema) and validate({ body, query, params })
  const schemas =
    schemasOrSingle &&
    (schemasOrSingle.body || schemasOrSingle.query || schemasOrSingle.params)
      ? schemasOrSingle
      : { body: schemasOrSingle };

  return (req, res, next) => {
    const errors = [];

    // Validate each target that has a schema
    const targets = ['body', 'query', 'params'];

    for (const target of targets) {
      const schema = schemas[target];
      if (!schema) continue;

      const result = schema.safeParse(req[target]);

      if (!result.success) {
        errors.push(
          ...formatZodIssues(result.error).map((e) => ({
            ...e,
            target, // so the client knows if it was body, query, or params
          }))
        );
      } else {
        // Replace with the parsed + coerced data
        // (e.g. "10" → 10 if the schema says z.coerce.number())
        // Note: req.query and req.params are getters in Express 4,
        // so we mutate in place instead of reassigning.
        if (target === 'body') {
          req.body = result.data;
        } else {
          Object.keys(req[target]).forEach((k) => delete req[target][k]);
          Object.assign(req[target], result.data);
        }
      }
    }

    if (errors.length > 0) {
      return next(
        new AppError(
          'Validation failed',
          422,
          'VALIDATION_ERROR',
          errors
        )
      );
    }

    next();
  };
}

module.exports = { validate };