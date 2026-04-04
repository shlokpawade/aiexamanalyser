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
// OCR
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
// MERGE TEXTS
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
// EXTRACT TEXT
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

      // ---- TEXT ----
      const content = await page.getTextContent();
      const text = content.items.map(i => i.str).join(" ");
      pdfText += "\n" + text;

      // ---- SMART OCR (ONLY IF NEEDED) ----
      if (text.length < 50) {
        const viewport = page.getViewport({ scale: 3 });

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvasContext: ctx, viewport }).promise;

        const ocr = await performOCR(canvas);
        ocrText += "\n" + ocr;
      }
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
// CHUNK PROMPT (FIXED)
// ======================
function buildChunkPrompt(chunk, subject) {
  return `
You are extracting exam questions.

SUBJECT: ${subject}

IMPORTANT:
- Extract ONLY questions
- Do NOT explain
- Do NOT add extra text
- Do NOT include code
- Ignore theory text

OUTPUT:
- question
- question

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

IMPORTANT:
- Do NOT explain
- Do NOT add text
- Only return cleaned questions

Rules:
- Remove duplicates
- Remove incomplete questions
- Keep only meaningful exam questions

DATA:
${results.join("\n")}
`;
  return await callWorkerSafe(prompt);
}

// ======================
// MERGE PROMPT (FIXED)
// ======================
function buildMergePrompt(cleaned) {
  return `
You are an exam analyzer.

IMPORTANT:
- Do NOT explain anything
- Do NOT give steps
- Do NOT give code
- Do NOT describe algorithms
- ONLY give final answer

TASK:
- Group questions by topic
- Find repeated concepts
- Count frequency
- Predict important exam questions

OUTPUT FORMAT (STRICT):

📌 Questions:
- question

🧠 Topics:
- Topic → count

🔁 Repeated Concepts:
- Concept → example questions (count)

🎯 Important Questions:
- question

⚠️ STRICT:
- No explanation
- No code
- No steps
- Only final structured answer

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
    output.innerText += `📄 Processing ${i + 1}/10\n`;

    const res = await callWorkerSafe(
      buildChunkPrompt(chunks[i], subject)
    );

    if (res) results.push(res);
  }

  output.innerText += "\n🧹 Cleaning...\n";

  const cleaned = await refineQuestions(results);

  output.innerText += "\n🧠 Analyzing...\n";

  return await callWorkerSafe(buildMergePrompt(cleaned));
}

// ======================
// BUTTON HANDLER (FIXED)
// ======================
document.addEventListener("DOMContentLoaded", () => {

  const btn = document.getElementById("analyzeBtn");
  const input = document.getElementById("fileInput");
  const output = document.getElementById("output");

  if (!btn || !input || !output) {
    console.error("❌ Missing HTML elements");
    return;
  }

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
