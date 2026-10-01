import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import qrcode from 'qrcode-terminal';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db';
import { users } from '../db/schema';
import { destroyAllSessions } from '../auth/session';
import { passwordProblem } from '../auth/password-policy';
import { encryptSecret, generateTotpSecret, otpauthUrl, verifyTotp } from '../auth/totp';

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
        if (s.includes(question)) process.stdout.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function getUser(email?: string) {
  if (!email) throw new Error('Informe o e-mail. Ex.: npm run user -- 2fa:enable gabriel@exemplo.com');
  const user = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });
  if (!user) throw new Error(`Usuário ${email} não encontrado (rode npm run seed antes).`);
  return user;
}

async function main() {
  const [cmd, email] = process.argv.slice(2);
  switch (cmd) {
    case '2fa:enable': {
      const user = await getUser(email);
      const secret = generateTotpSecret();
      const url = otpauthUrl(secret, user.email);
      console.log('\nEscaneie no app autenticador (Google Authenticator, Authy, 1Password, Bitwarden…):\n');
      qrcode.generate(url, { small: true });
      console.log(`\nOu digite a chave manualmente: ${secret}\n`);
      const code = await ask('Digite o código de 6 dígitos que apareceu no app: ');
      if (verifyTotp(secret, code, null) === null) throw new Error('Código inválido. Nada foi alterado.');
      await db
        .update(users)
        .set({ totpSecret: encryptSecret(secret), totpLastStep: null })
        .where(eq(users.id, user.id));
      await destroyAllSessions(user.id);
      console.log(`✅ 2FA ativado para ${user.email}. Sessões antigas encerradas.`);
      break;
    }
    case '2fa:disable': {
      const user = await getUser(email);
      await db.update(users).set({ totpSecret: null, totpLastStep: null }).where(eq(users.id, user.id));
      console.log(`2FA desativado para ${user.email}.`);
      break;
    }
    case 'password': {
      const user = await getUser(email);
      const pw = await ask('Nova senha: ', true);
      const problem = passwordProblem(pw);
      if (problem) throw new Error(`Senha recusada: ${problem}`);
      if ((await ask('Confirme a senha: ', true)) !== pw) throw new Error('As senhas não conferem.');
      await db
        .update(users)
        .set({ passwordHash: await bcrypt.hash(pw, 12), failedLoginAttempts: 0, lockedUntil: null })
        .where(eq(users.id, user.id));
      await destroyAllSessions(user.id);
      console.log(`✅ Senha de ${user.email} alterada. Sessões antigas encerradas.`);
      break;
    }
    case 'logout-all': {
      const user = await getUser(email);
      await destroyAllSessions(user.id);
      console.log(`Todas as sessões de ${user.email} foram encerradas.`);
      break;
    }
    case 'unlock': {
      const user = await getUser(email);
      await db.update(users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));
      console.log(`${user.email} desbloqueado.`);
      break;
    }
    default:
      console.log('Comandos: 2fa:enable | 2fa:disable | password | logout-all | unlock  <email>');
  }
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
