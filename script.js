const WORKER_URL = "https://steep-rain-8637.pawadesh lok.workers.dev".replace(" ", "");

// ======================
// DELAY
// ======================
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ======================
// SMART CHUNKING (MAX 10)
// ======================
function splitIntoChunks(text) {
  const MAX_CHUNKS = 10;

  const words = text.split(/\s+/);
  const chunkSize = Math.ceil(words.length / MAX_CHUNKS);

  let chunks = [];

  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(" "));
  }

  console.log("Total chunks:", chunks.length);
  return chunks;
}

// ======================
// SAFE API CALL
// ======================
async function callWorkerSafe(prompt) {
  const MAX_RETRIES = 3;
  const TIMEOUT = 25000;

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

      if (!data.output || data.output.trim().length < 20) {
        throw new Error("Weak response");
      }

      return data.output;

    } catch (err) {
      console.log(`⚠️ Retry ${attempt}`);

      if (attempt === MAX_RETRIES) {
        console.log("❌ Worker failed");
        return "";
      }

      await delay(1500);
    }
  }
}

// ======================
// CLEAN TEXT (VERY IMPORTANT)
// ======================
function cleanText(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9.,?()\n\- ]/g, "")
    .trim();
}

// ======================
// YOUR PROMPTS (UNCHANGED)
// ======================
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

// ======================
// MAIN ANALYSIS
// ======================
async function analyze(text) {
  text = cleanText(text);

  const chunks = splitIntoChunks(text);
  let results = [];

  for (let i = 0; i < chunks.length; i++) {
    console.log(`Processing chunk ${i + 1}/${chunks.length}`);

    const res = await callWorkerSafe(buildChunkPrompt(chunks[i]));

    if (!res || res.length < 20) {
      console.log("⚠️ Skipping weak chunk");
      continue;
    }

    results.push(res);
    await delay(800);
  }

  console.log("Merging results...");

  const finalResult = await callWorkerSafe(buildMergePrompt(results));

  return finalResult || "❌ Failed to generate result.";
}

// ======================
// OCR IMAGE
// ======================
async function extractImageText(file) {
  const { data: { text } } = await Tesseract.recognize(file, "eng");
  return text;
}

// ======================
// PDF TEXT + OCR (BEST)
// ======================
async function extractPDFText(file) {
  const pdf = await pdfjsLib.getDocument(await file.arrayBuffer()).promise;
  let text = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    console.log("📄 Page", i);

    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(" ");

    if (pageText.trim().length < 20) {
      console.log("🔍 OCR on page", i);

      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      // 🔥 OCR IMPROVEMENT
      ctx.filter = "grayscale(1) contrast(2)";

      await page.render({ canvasContext: ctx, viewport }).promise;

      const { data: { text: ocrText } } =
        await Tesseract.recognize(canvas, "eng");

      text += ocrText + "\n";
    } else {
      text += pageText + "\n";
    }
  }

  return text;
}

// ======================
// FILE HANDLER
// ======================
async function extractTextFromFile(file) {
  if (file.type === "application/pdf") {
    return await extractPDFText(file);
  } else if (file.type.startsWith("image/")) {
    return await extractImageText(file);
  } else {
    return await file.text();
  }
}

// ======================
// BUTTON HANDLER
// ======================
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("analyzeBtn");

  if (!btn) {
    console.error("❌ analyzeBtn not found");
    return;
  }

  btn.addEventListener("click", async () => {
    const fileInput = document.getElementById("fileInput");
    const resultBox = document.getElementById("output");

    if (!resultBox) {
      console.error("❌ output element missing");
      return;
    }

    if (!fileInput.files.length) {
      alert("Please upload files");
      return;
    }

    resultBox.innerText = "🔍 Processing... Please wait ⏳";

    try {
      let fullText = "";

      for (let file of fileInput.files) {
        const text = await extractTextFromFile(file);
        fullText += text + "\n";
      }

      const output = await analyze(fullText);

      resultBox.innerText = output;

    } catch (err) {
      console.error(err);
      resultBox.innerText = "❌ Error occurred";
    }
  });
});
