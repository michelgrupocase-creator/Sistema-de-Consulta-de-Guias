/**
 * Autorização única do Google Drive (modo oauth).
 *
 *   npm run drive-autorizar
 *
 * Imprime o refresh token. Guarde-o em variável de ambiente, NUNCA em
 * arquivo dentro do repositório: ele dá acesso ao Drive do escritório.
 */
import { carregarConfig } from './config.js';
import { autorizar } from './drive.js';

const config = await carregarConfig();
if (!config.drive?.clientId) {
  console.error(
    'Falta configurar drive.clientId e drive.clientSecret no config.json.\n' +
      'Crie as credenciais em https://console.cloud.google.com > APIs e Serviços >\n' +
      'Credenciais > Criar credenciais > ID do cliente OAuth > Aplicativo para computador.'
  );
  process.exit(1);
}

const token = await autorizar(config.drive);
console.log('\n=== GUARDE ISTO ===\n');
console.log(`export DRIVE_REFRESH_TOKEN='${token}'    # Linux/macOS`);
console.log(`setx DRIVE_REFRESH_TOKEN "${token}"      # Windows (reabra o terminal)`);
console.log('\nNão coloque este token em nenhum arquivo do projeto.');
