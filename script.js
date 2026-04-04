const WORKER_URL = "https://steep-rain-8637.pawadesh lok.workers.dev".replace(" ", "");

// ✅ Delay (for retry only)
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ✅ SAFE API (no timeout crash)
async function callWorkerSafe(prompt) {
  let attempt = 0;

  while (attempt < 5) {
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

      throw new Error("Empty");

    } catch (err) {
      attempt++;
      console.log(`🔁 Retry ${attempt}`);
      await delay(1200);
    }
  }

  return "";
}

// 🔥 YOUR PROMPT (UNCHANGED)
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

// 🔥 OCR (BEST VERSION)
async function performOCR(file) {
  const { createWorker } = Tesseract;
  const worker = await createWorker("eng");

  const { data: { text } } = await worker.recognize(file);

  await worker.terminate();

  return text;
}

// 🔥 SMART QUESTION FILTER (BIGGEST UPGRADE)
function extractQuestionsOnly(text) {
  const lines = text.split("\n");

  return lines
    .map(l => l.trim())
    .filter(l =>
      l.length > 15 &&
      (
        l.endsWith("?") ||
        l.match(/^(what|explain|define|describe|compare|differentiate|write|list|state|discuss)/i)
      )
    )
    .join("\n");
}

// 🔥 SMART CHUNKING (BY QUESTIONS)
function splitIntoChunks(text) {
  const lines = text.split("\n");
  const chunkSize = 20; // 20 questions per chunk

  let chunks = [];

  for (let i = 0; i < lines.length; i += chunkSize) {
    chunks.push(lines.slice(i, i + chunkSize).join("\n"));
  }

  return chunks;
}

// 🚀 PARALLEL PROCESSING (FAST)
async function processChunksParallel(chunks, concurrency = 4) {
  let results = [];
  let index = 0;

  async function worker() {
    while (index < chunks.length) {
      const i = index++;
      console.log(`Processing chunk ${i + 1}/${chunks.length}`);

      const res = await callWorkerSafe(buildChunkPrompt(chunks[i]));
      results[i] = res;
    }
  }

  let workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

// 🔥 FINAL ANALYZE (OPTIMIZED PIPELINE)
async function analyze(text) {

  // 1️⃣ Clean
  text = text.replace(/[^\x00-\x7F]/g, "").trim();

  // 2️⃣ Extract only questions (CRITICAL)
  text = extractQuestionsOnly(text);

  console.log("Filtered question text length:", text.length);

  // 3️⃣ Chunk by questions
  const chunks = splitIntoChunks(text);

  console.log(`🚀 Final chunks: ${chunks.length}`);

  // 4️⃣ Process
  const results = await processChunksParallel(chunks, 4);

  // 5️⃣ Merge
  return await callWorkerSafe(buildMergePrompt(results));
}

// ✅ FILE TEXT EXTRACTION
async function extractText(file) {

  if (file.type.startsWith("image/")) {
    return await performOCR(file);
  }

  const text = await file.text();

  if (text.length < 50) {
    return await performOCR(file);
  }

  return text;
}

// ✅ BUTTON HANDLER
document.addEventListener("DOMContentLoaded", () => {

  document.getElementById("analyzeBtn").addEventListener("click", async () => {

    const fileInput = document.getElementById("fileInput");
    const resultBox = document.getElementById("output");

    if (!fileInput.files.length) {
      alert("Please upload files");
      return;
    }

    resultBox.innerText = "Processing smart analysis... ⏳";

    try {
      let fullText = "";

      for (let file of fileInput.files) {
        const text = await extractText(file);
        fullText += text + "\n";
      }

      const output = await analyze(fullText);

      resultBox.innerText = output;

    } catch (err) {
      console.error(err);
      resultBox.innerText = "Error occurred ❌";
    }

  });

});
