// ===============================================
//  AI EXAM ANALYZER – FINAL PRO VERSION 🚀
// ===============================================

const WORKER_URL = "https://steep-rain-8637.pawadeshlok.workers.dev/";

window.latestAIOutput = "";
let startTime = 0;

// PDF.js worker
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.9.179/pdf.worker.min.js";
}

// ===============================================
// UI
// ===============================================
function updateLoading(text, progress) {
  const box = document.getElementById("loadingContainer");
  box.classList.remove("hidden");

  const timeElapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  document.getElementById("loadingText").innerText =
    `${text} (${timeElapsed}s)`;

  document.getElementById("progressFill").style.width =
    Math.min(progress, 100) + "%";
}

// ===============================================
// OCR
// ===============================================
async function extractPDFText(file) {
  let finalText = "";

  const pdf = await pdfjsLib.getDocument(URL.createObjectURL(file)).promise;

  for (let i = 1; i <= pdf.numPages; i++) {
    updateLoading(`📷 OCR page ${i}/${pdf.numPages}`, 5 + (i / pdf.numPages) * 25);

    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;

    const { data: { text } } = await Tesseract.recognize(canvas, "eng");

    finalText += "\n\n" + text;
  }

  return finalText;
}

// ===============================================
// CLEAN OCR TEXT (🔥 IMPORTANT)
// ===============================================
function cleanText(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9?.\-:,() ]/g, "")
    .trim();
}

// ===============================================
// CHUNKING
// ===============================================
function splitIntoChunks(text) {
  const size = 800;
  let chunks = [];

  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }

  return chunks;
}

// ===============================================
// 🔥 ULTRA-STRICT CHUNK PROMPT
// ===============================================
function buildChunkPrompt(chunkText, index, total) {
  return `
You are analyzing a REAL university exam paper.

STRICT RULES:
- ONLY extract questions EXACTLY as written
- DO NOT modify wording
- DO NOT create new questions
- IGNORE instructions like "Attempt any"
- If unclear → SKIP

TEXT:
${chunkText}

OUTPUT:

Chunk ${index}/${total}

Questions:
- exact question

Repeated:
- repeated question

Topics:
- short topic
`;
}

// ===============================================
// 🔥 FINAL MERGE + PREDICTION PROMPT
// ===============================================
function buildMergePrompt(chunkAnalyses) {
  return `
Combine exam analysis.

STRICT:
- DO NOT add new questions
- ONLY use given data
- Remove duplicates

OUTPUT:

📌 Final Questions:
- question

🔁 Repeated Questions (with count):
- question (2 times)

🧩 Important Topics:
- topic

🎯 Predicted Questions:
- most repeated questions

🗓️ Study Strategy:
- Focus on repeated topics
- Ignore rare topics

DATA:
${chunkAnalyses.join("\n")}
`;
}

// ===============================================
// API CALL
// ===============================================
async function callWorker(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: prompt }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) throw new Error("Server error");

    const data = await res.json();

    if (data.error) throw new Error(data.error);

    return data.output;

  } catch (err) {
    console.log("⚠️ Skipped chunk");
    return "⚠️ Skipped due to timeout";
  }
}

// ===============================================
// MAIN
// ===============================================
async function analyze() {
  const files = document.getElementById("fileInput").files;
  const output = document.getElementById("output");

  if (!files.length) {
    alert("Upload files");
    return;
  }

  startTime = Date.now();
  updateLoading("🚀 Starting...", 2);

  let text = "";

  for (let f of files) {
    text += await extractPDFText(f);
  }

  // 🔥 CLEAN TEXT
  text = cleanText(text);

  // 🔥 LIMIT TEXT
  if (text.length > 6000) {
    text = text.slice(0, 6000);
  }

  const chunks = splitIntoChunks(text);
  let results = [];

  for (let i = 0; i < chunks.length; i++) {
    updateLoading(`✨ Chunk ${i + 1}/${chunks.length}`, 30 + (i / chunks.length) * 40);

    const res = await callWorker(
      buildChunkPrompt(chunks[i], i + 1, chunks.length)
    );

    results.push(res);
  }

  updateLoading("🧠 Generating predictions...", 85);

  const final = await callWorker(buildMergePrompt(results));

  output.innerHTML = marked.parse(final);
  updateLoading("✅ Done", 100);
}

// ===============================================
// EVENTS
// ===============================================
document.getElementById("analyzeBtn").onclick = () => {
  analyze().catch(err => {
    document.getElementById("output").innerHTML =
      `<div class='error'>❌ ${err.message}</div>`;
  });
};
