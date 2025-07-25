import formidable from "formidable";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { exiftool } from "exiftool-vendored";

export const config = {
  api: {
    bodyParser: false,
  },
};

const TMP_FOLDER = "/tmp";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const form = formidable({
    multiples: false,
    keepExtensions: true,
    uploadDir: TMP_FOLDER,
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("Form parse error:", err);
      res.status(500).send("Error parsing the form");
      return;
    }

    try {
      const imageFile = files.image.filepath;
      const width = fields.width ? parseInt(fields.width) : null;
      const height = fields.height ? parseInt(fields.height) : null;
      const format = (fields.format || "png").toLowerCase();
      const preset = fields.preset || "";
      const metadataRaw = fields.metadata || "";
      const embeddedCode = fields.code || "";

      // Load metadata JSON if provided
      let metadataObj = {};
      if (metadataRaw) {
        try {
          metadataObj = JSON.parse(metadataRaw);
        } catch (e) {
          console.warn("Invalid metadata JSON, ignoring metadata input");
          metadataObj = {};
        }
      }

      // If embedded code provided, store it in UserComment tag
      if (embeddedCode) {
        metadataObj.UserComment = embeddedCode;
      }

      // Prepare sharp pipeline
      let image = sharp(imageFile).rotate();

      const originalMeta = await sharp(imageFile).metadata();
      const newWidth = width || originalMeta.width;
      const newHeight = height || originalMeta.height;

      image = image.resize(newWidth, newHeight);

      // Apply presets
      if (preset === "compress") {
        if (format === "jpeg") {
          image = image.jpeg({ quality: 40 });
        } else if (format === "png") {
          image = image.png({ compressionLevel: 9 });
        } else if (format === "webp") {
          image = image.webp({ quality: 40 });
        }
      } else if (preset === "resize50") {
        image = image.resize(Math.floor(originalMeta.width * 0.5), Math.floor(originalMeta.height * 0.5));
      } else if (preset === "resize75") {
        image = image.resize(Math.floor(originalMeta.width * 0.75), Math.floor(originalMeta.height * 0.75));
      }

      // Output temp file path
      const tempOutPath = path.join(TMP_FOLDER, `out-${Date.now()}.${format}`);

      // Save resized and formatted image to temp file
      await image.toFile(tempOutPath);

      // Write metadata with exiftool
      if (Object.keys(metadataObj).length > 0) {
        try {
          await exiftool.write(tempOutPath, metadataObj);
        } catch (e) {
          console.warn("Exiftool metadata write failed:", e);
        }
      }

      // Read final processed file
      const finalBuffer = await fs.readFile(tempOutPath);

      // Cleanup temp files
      await fs.unlink(imageFile);
      await fs.unlink(tempOutPath);

      res.setHeader("Content-Type", `image/${format === "jpeg" ? "jpeg" : format}`);
      res.send(finalBuffer);
    } catch (error) {
      console.error("Error processing image:", error);
      res.status(500).send("Error processing image");
    }
  });
}
