# LingoSync - Aprenda Inglês com Input Compreensivo

O **LingoSync** é uma plataforma moderna e poderosa para o aprendizado de inglês, utilizando a técnica de **Input Compreensivo**. Ele permite que usuários transformem arquivos de áudio locais (MP3/WAV) em lições personalizadas com legendas sincronizadas, permitindo inclusive a sincronização manual com vídeos do YouTube para uma experiência imersiva.

## 🚀 Arquitetura e Deploy

Este projeto é uma **Single Page Application (SPA)** desenvolvida com **Vite + React + TypeScript**. Ele foi otimizado para rodar inteiramente no navegador, eliminando a necessidade de servidores caros ou complexos.

### Vantagens para o Administrador:
1.  **Custo Zero de Servidor**: Pode ser hospedado gratuitamente na Netlify ou Vercel.
2.  **Privacidade Total**: O processamento de áudio e texto acontece no dispositivo do usuário.
3.  **Modelo BYOK (Bring Your Own Key)**: Os custos de AI são de responsabilidade do usuário final, que utiliza sua própria **Gemini API Key**.
4.  **Escalabilidade Infinita**: Como não há banco de dados centralizado ou processamento no servidor, o app suporta 2.000 ou 200.000 usuários com o mesmo desempenho.

### Comandos:
- **Instalação**: `npm install`
- **Desenvolvimento**: `npm run dev`
- **Build para Produção**: `npm run build`
- **Diretório de Saída**: `dist`

## 🛠 Tecnologias Utilizadas
- **React 18 & Vite**
- **Tailwind CSS** (Design moderno e responsivo)
- **Google Gemini API** (Transcrição, Tradução e Narração via Cliente)
- **IndexedDB** (Armazenamento local para as lições e áudios)

## 📖 Fluxo de Uso Atual
1. **Upload**: O usuário faz o upload manual de um arquivo de áudio.
2. **Transcrição**: O app usa a API do Gemini do usuário para transcrever e traduzir.
3. **Flashcards**: Geração inteligente de flashcards com áudio (Text-to-Speech via API).
4. **Sincronização de Vídeo**: Opção para inserir um link do YouTube e ajustar o tempo manualmente para estudar com imagem e som.

---
Projeto configurado para deploy imediato. Basta conectar o repositório à Netlify e apontar o comando de build para `npm run build`.