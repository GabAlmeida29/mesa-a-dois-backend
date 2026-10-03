import { z } from 'zod';

z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `Máximo de ${issue.maximum} caracteres` };
      if (issue.type === 'number') return { message: `O valor máximo é ${issue.maximum}` };
      if (issue.type === 'array') return { message: `Máximo de ${issue.maximum} itens` };
      break;
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') {
        return {
          message: Number(issue.minimum) <= 1 ? 'Campo obrigatório' : `Mínimo de ${issue.minimum} caracteres`,
        };
      }
      if (issue.type === 'number') return { message: `O valor mínimo é ${issue.minimum}` };
      break;
    case z.ZodIssueCode.invalid_type:
      return {
        message:
          issue.received === 'undefined' || issue.received === 'null'
            ? 'Campo obrigatório'
            : 'Valor inválido',
      };
    case z.ZodIssueCode.invalid_string:
      return { message: issue.validation === 'email' ? 'E-mail inválido' : 'Formato inválido' };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: 'Opção inválida' };
    case z.ZodIssueCode.not_multiple_of:
      return { message: `Use múltiplos de ${issue.multipleOf}` };
  }
  return { message: ctx.defaultError };
});
