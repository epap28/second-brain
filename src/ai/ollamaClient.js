const DEFAULT_OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'mistral:7b';

function buildPrompt({ category, note }) {
  const categoryBlock = `Catégorie : ${category?.name || '(sans titre)'}`;
  const noteBlock = `Note actuelle :\n${note?.content || '(note vide)'}`;

  return [
    'Tu es un assistant local qui répond exclusivement en français, même si la note est dans une autre langue.',
    'Analyse la note et le contexte ci-dessous et approfondis le. Ta mission : enrichir le contenu, pas le résumer ni le réécrire.',
    'Règles :',
    '1. Ne répète ni ne paraphrase la note existante.',
    '2. Ne redis pas dans tes propres mots les informations déjà présentes.',
    '3. Signale seulement les points qui méritent un complément, une vérification ou des précisions.',
    '4. Structure ta réponse en puces et sois concis : 3 puces maximum, parle en mots clés, pas de phrases complètes.',
    '',
    categoryBlock,
    noteBlock,
    '',
    'Maintenant, fournis uniquement les compléments nécessaires en suivant les règles ci-dessus.'
  ].join('\n');
}

async function generateNoteFeedback({ category, note, model = DEFAULT_MODEL, ollamaUrl = DEFAULT_OLLAMA_URL }) {
  const prompt = buildPrompt({ category, note });
  const url = `${ollamaUrl.replace(/\/$/, '')}/api/generate`;

  let body;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama request failed (${response.status}): ${text}`);
    }

    body = await response.json();
  } catch (error) {
    throw new Error(`Failed to generate AI comment: ${error.message}`);
  }

  const text = (body?.response || '').trim() || 'AI assistant could not produce feedback for this note.';

  return {
    text,
    model: body?.model || model,
    metadata: {
      prompt,
      contextLength: Array.isArray(body?.context) ? body.context.length : null,
    },
  };
}

module.exports = {
  generateNoteFeedback,
};
