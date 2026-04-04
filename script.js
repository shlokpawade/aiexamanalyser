
const WORKER_URL = "https://steep-rain-8637.pawadesh lok.workers.dev".replace(" ", "");

// ✅ Delay
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ✅ SMART CHUNKING (MAX 10 CHUNKS ONLY)
function splitIntoChunks(text) {
  const MAX_CHUNKS = 10;

  text = text.replace(/\s+/g, " ").trim();

  const length = text.length;

  if (length < 2000) return [text];

  const chunkSize = Math.ceil(length / MAX_CHUNKS);
  let chunks = [];

  for (let i = 0; i < length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }

  console.log(`✅ Total chunks created: ${chunks.length}`);
  return chunks;
}

// ✅ SAFE API CALL (NO SKIP / NO FAIL)
async function callWorkerSafe(prompt) {
  let attempt = 0;

  while (true) {
    try {
      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: prompt })
      });

      if (!res.ok) throw new Error("Server error");

      const data = await res.json();

      if (data.output && data.output.trim() !== "") {
        return data.output;
      }

      throw new Error("Empty response");

    } catch (err) {
      attempt++;
      console.log(`🔁 Retry attempt ${attempt}`);
      await delay(1500);
    }
  }
}

// 🔥 YOUR CHUNK PROMPT (UNCHANGED)
function buildChunkPrompt(chunk) {
  return `
You are an expert exam paper analyzer.

Your job is to carefully read the given text and extract ONLY valid exam questions.

STRICT RULES:
- Extract only meaningful questions
- Ignore headings, instructions, random text
- Ignore incomplete or broken sentences
- Fix grammar if needed
- Normalize abbreviations:
  - DFS = Depth First Search
  - AI = Artificial Intelligence
  - DBMS = Database Management System

VERY IMPORTANT:
- If questions are similar but worded differently, rewrite them in a standard clear format
- Each question must be clean and complete

OUTPUT FORMAT (STRICT):
Questions:
- Question 1
- Question 2
- Question 3

DO NOT:
- Add explanations
- Add extra text
- Return anything except the list

TEXT:
${chunk}
`;
}

// 🔥 YOUR MERGE PROMPT (UNCHANGED)
function buildMergePrompt(chunkAnalyses) {
  return `
You are cleaning and organizing exam questions.

Rules:
- Remove duplicates
- Remove incomplete questions
- Keep only meaningful questions
- Do NOT add anything new

🔥 VERY IMPORTANT (CORE LOGIC):
- Questions with SAME MEANING must be treated as SAME
- Do NOT rely on exact wording
- Group similar questions under ONE concept

Examples:
- "Explain DFS" = "Explain Depth First Search"
- "Define normalization" = "What is normalization"
- "Explain A* algorithm" = "Describe A star algorithm"

TASK:

1. Merge all questions
2. Group similar meaning questions
3. Count repetition based on CONCEPT (not wording)
4. Identify important topics
5. Predict most probable exam questions

OUTPUT:

📌 Final Questions:
- clean unique question

🔁 Repeated Questions (Concept-based):
- Concept → example questions (2 times)
- Concept → example questions (3 times)

🧩 Important Topics:
- topic

🎯 Predicted Questions (HIGH PROBABILITY):
- question

🗓️ Study Strategy:
- Focus on repeated concepts
- Practice variations of same concept

IMPORTANT:
- Complete full response
- Do NOT cut output
- Use meaning-based grouping

DATA:
${chunkAnalyses.join("\n")}
`;
}

// ✅ MAIN ANALYSIS WITH LIVE OUTPUT
async function analyze(text, resultBox) {

  // 🔥 Clean text (boost accuracy)
  text = text
    .replace(/Page \d+/gi, "")
    .replace(/University.*?\n/gi, "")
    .replace(/Time:.*?\n/gi, "")
    .replace(/Marks:.*?\n/gi, "");

  const chunks = splitIntoChunks(text);
  let results = [];

  resultBox.innerText = `🚀 Starting analysis...\n\n`;

  for (let i = 0; i < chunks.length; i++) {
    resultBox.innerText += `📄 Processing chunk ${i + 1}/${chunks.length}...\n`;

    const res = await callWorkerSafe(buildChunkPrompt(chunks[i]));
    results.push(res);

    resultBox.innerText += `✅ Chunk ${i + 1} done\n\n`;

    await delay(500);
  }

  resultBox.innerText += `\n🔄 Merging final results...\n`;

  const finalResult = await callWorkerSafe(buildMergePrompt(results));

  return finalResult;
}

// ✅ BUTTON HANDLER (ERROR SAFE + LIVE UI)
document.addEventListener("DOMContentLoaded", () => {

  const analyzeBtn = document.getElementById("analyzeBtn");
  const fileInput = document.getElementById("fileInput");
  const resultBox = document.getElementById("output");

  if (!analyzeBtn || !fileInput || !resultBox) {
    console.error("❌ Missing HTML elements");
    return;
  }

  analyzeBtn.addEventListener("click", async () => {

    if (!fileInput.files.length) {
      alert("Please upload files");
      return;
    }

    resultBox.innerText = "⏳ Reading files...\n";

    try {
      let fullText = "";

      for (let file of fileInput.files) {
        const text = await file.text(); // OCR not needed for text PDFs
        fullText += text + "\n";
      }

      const output = await analyze(fullText, resultBox);

      resultBox.innerText = "\n\n🎉 FINAL RESULT:\n\n" + output;

    } catch (err) {
      console.error(err);
      resultBox.innerText = "❌ Error occurred";
    }

  });

});
