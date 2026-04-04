const WORKER_URL = "https://steep-rain-8637.pawadesh lok.workers.dev".replace(" ", "");

// ======================
// DELAY
// ======================
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ======================
// SAFE API CALL
// ======================
async function callWorkerSafe(prompt) {
  const MAX_RETRIES = 3;
  const TIMEOUT = 15000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: prompt }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) throw new Error("Server error");

      const data = await res.json();

      if (data.output && data.output.trim() !== "") {
        return data.output;
      }

      throw new Error("Empty response");

    } catch (err) {
      console.log(`⚠️ Retry ${attempt}`);
      await delay(1000);
    }
  }

  return "";
}

// ======================
// OCR FUNCTION
// ======================
async function performOCR(image) {
  const worker = await Tesseract.createWorker("eng");

  const { data: { text } } = await worker.recognize(image, {
    tessedit_pageseg_mode: 6
  });

  await worker.terminate();
  return text;
}

// ======================
// MERGE PDF + OCR TEXT
// ======================
function mergeTexts(pdfText, ocrText) {

  if (ocrText.length > pdfText.length * 1.5) {
    return ocrText;
  }

  if (pdfText.length > 1000) {
    return pdfText;
  }

  return pdfText + "\n" + ocrText;
}

// ======================
// HYBRID EXTRACTION
// ======================
async function extractText(file) {

  // IMAGE
  if (file.type.startsWith("image/")) {
    return await performOCR(file);
  }

  // PDF
  if (file.type === "application/pdf") {

    const pdf = await pdfjsLib.getDocument(URL.createObjectURL(file)).promise;

    let pdfText = "";
    let ocrText = "";

    for (let i = 1; i <= pdf.numPages; i++) {

      console.log(`📄 Page ${i}`);

      const page = await pdf.getPage(i);

      // ---- TEXT EXTRACTION ----
      const content = await page.getTextContent();
      const text = content.items.map(i => i.str).join(" ");
      pdfText += "\n" + text;

      // ---- OCR ----
      const viewport = page.getViewport({ scale: 3 });

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: ctx, viewport }).promise;

      const ocr = await performOCR(canvas);
      ocrText += "\n" + ocr;
    }

    return mergeTexts(pdfText, ocrText);
  }

  // TEXT FILE
  return await file.text();
}

// ======================
// CLEAN TEXT
// ======================
function cleanText(text) {
  return text
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ======================
// MAX 10 CHUNKS
// ======================
function splitIntoChunks(text) {
  const MAX = 10;
  const size = Math.ceil(text.length / MAX);

  let chunks = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }

  return chunks;
}

// ======================
// SUBJECT DETECTION
// ======================
async function detectSubject(text) {
  const prompt = `
Identify subject of this exam paper in 3-5 words only.

TEXT:
${text.slice(0, 2000)}
`;

  return await callWorkerSafe(prompt);
}

// ======================
// EXTRACT QUESTIONS
// ======================
function buildChunkPrompt(chunk, subject) {
  return `
You are an expert exam parser.

SUBJECT: ${subject}

Extract ONLY complete and meaningful questions.

Rules:
- No headings
- No instructions
- No incomplete text
- Fix grammar if needed

TEXT:
${chunk}
`;
}

// ======================
// CLEAN QUESTIONS
// ======================
async function refineQuestions(results) {
  const prompt = `
Clean and standardize questions.

- Remove duplicates
- Remove incomplete ones
- Keep only exam-ready questions

DATA:
${results.join("\n")}
`;

  return await callWorkerSafe(prompt);
}

// ======================
// CLUSTER + PREDICT
// ======================
function buildMergePrompt(cleaned) {
  return `
Analyze and cluster exam questions.

Tasks:
- Group by topic
- Count frequency
- Detect repeated concepts
- Predict important questions

OUTPUT:

📌 Questions:
- question

🧠 Topics:
- Topic → (count)

🎯 Important Questions:
- question

DATA:
${cleaned}
`;
}

// ======================
// MAIN ANALYSIS
// ======================
async function analyze(text, output) {

  output.innerText = "🔍 Detecting subject...\n";

  const subject = await detectSubject(text);

  output.innerText += `📘 ${subject}\n\n`;

  text = cleanText(text);

  const chunks = splitIntoChunks(text);

  let results = [];

  for (let i = 0; i < chunks.length; i++) {
    output.innerText += `📄 Chunk ${i + 1}/10\n`;

    const res = await callWorkerSafe(
      buildChunkPrompt(chunks[i], subject)
    );

    results.push(res);
  }

  output.innerText += "\n🧹 Cleaning...\n";

  const cleaned = await refineQuestions(results);

  output.innerText += "\n🧠 Clustering...\n";

  return await callWorkerSafe(buildMergePrompt(cleaned));
}

// ======================
// BUTTON HANDLER
// ======================
document.addEventListener("DOMContentLoaded", () => {

  const btn = document.getElementById("analyzeBtn");
  const input = document.getElementById("fileInput");
  const output = document.getElementById("output");

  btn.addEventListener("click", async () => {

    if (!input.files.length) {
      alert("Upload file");
      return;
    }

    output.innerText = "⏳ Processing...\n";

    try {
      let text = "";

      for (let file of input.files) {
        const extracted = await extractText(file);
        text += extracted + "\n";
      }

      const result = await analyze(text, output);

      output.innerText = "\n\n🎉 FINAL OUTPUT:\n\n" + result;

    } catch (err) {
      console.error(err);
      output.innerText = "❌ Error occurred";
    }

  });

});
