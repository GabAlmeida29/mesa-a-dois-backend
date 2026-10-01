const COMMON = ['troque', 'senha', 'password', '123456', 'qwerty', 'mesaadois', 'mesa-a-dois'];

export function passwordProblem(pw: string): string | null {
  if (pw.length < 12) return 'mínimo de 12 caracteres';
  const lower = pw.toLowerCase();
  if (COMMON.some((w) => lower.includes(w))) return 'contém termo comum/óbvio';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes < 3) return 'use ao menos 3 tipos: minúsculas, maiúsculas, números, símbolos';
  return null;
}
