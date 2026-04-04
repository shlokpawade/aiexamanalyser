const WORKER_URL = "https://steep-rain-8637.pawadesh lok.workers.dev".replace(" ", "");

// ✅ Delay
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ✅ Bigger chunks (optimized)
function splitIntoChunks(text) {
  const size = 5000;
  let chunks = [];

  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }

  return chunks;
}

// ✅ Safe API
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

      throw new Error("Empty response");

    } catch (err) {
      attempt++;
      console.log(`🔁 Retry ${attempt}`);
      await delay(1500);
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

// 🚀 PARALLEL PROCESSING
async function processChunksParallel(chunks, concurrency = 5) {
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

// 🔥 OCR FUNCTION (MAIN UPGRADE)
async function performOCR(file) {
  const { createWorker } = Tesseract;

  const worker = await createWorker("eng");

  console.log("🔍 OCR started...");

  const { data: { text } } = await worker.recognize(file);

  await worker.terminate();

  return text;
}

// ✅ TEXT EXTRACTION (SMART)
async function extractText(file) {

  const fileType = file.type;

  // 🖼️ IMAGE → OCR
  if (fileType.startsWith("image/")) {
    return await performOCR(file);
  }

  // 📄 TEXT PDF
  const text = await file.text();

  // If empty → fallback OCR
  if (text.trim().length < 50) {
    console.log("⚠️ Low text detected → using OCR fallback");
    return await performOCR(file);
  }

  return text;
}

// ✅ MAIN ANALYSIS
async function analyze(text) {
  const chunks = splitIntoChunks(text);

  console.log(`Total chunks: ${chunks.length}`);

  const results = await processChunksParallel(chunks, 5);

  console.log("Merging results...");

  return await callWorkerSafe(buildMergePrompt(results));
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

    resultBox.innerText = "Processing with OCR... ⏳";

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
