# Funilhot

Projeto estático com páginas de venda e funil de conversão para a landing page do Funilhot.

## Arquivos principais
- index.html
- checkout.html
- upsell-checkout.html
- upsell-mensal.html
- upsell-trimestral.html
- downsell-mensal.html
- downsell-trimestral.html
- obrigado.html

## Checkout seguro
- O formulário de checkout agora envia os dados para um endpoint seguro em /api/checkout.
- A chave secreta do provedor não precisa ser exposta no navegador.
- Para integrar com o provedor real, defina as variáveis de ambiente CASHIN_API_URL e CASHIN_SECRET_KEY antes de iniciar o servidor.

## Como visualizar localmente
1. Instale as dependências com npm install.
2. Execute npm start.
3. Acesse http://localhost:3000.
