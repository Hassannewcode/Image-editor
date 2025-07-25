import formidable from 'formidable';
import fs from 'fs';
import sharp from 'sharp';
import { exiftool } from 'exiftool-vendored';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  const form = new formidable.IncomingForm({ keepExtensions: true });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      res.status(500).send('Form parsing error: ' + err.message);
      return;
    }

    if (!files.image) {
      res.status(400).send('No image uploaded');
      return;
    }

    const { width, height, format, metadata, quality, embedCode, allowDangerousCode } = fields;

    try {
      const filepath = files.image.filepath;
      const inputBuffer = await fs.promises.readFile(filepath);

      // Resize and format conversion with quality
      let img = sharp(inputBuffer)
        .resize(parseInt(width), parseInt(height))
        .toFormat(format, { quality: parseInt(quality) });

      const outputBuffer = await img.toBuffer();

      // Read original metadata
      let originalMeta = {};
      try {
        originalMeta = await exiftool.read(filepath);
      } catch {
        originalMeta = {};
      }

      // Parse user metadata JSON or empty
      let userMeta = {};
      if (metadata && metadata.trim() !== '') {
        try {
          userMeta = JSON.parse(metadata);
        } catch {
          res.status(400).send('Invalid JSON metadata');
          return;
        }
      }

      // Merge metadata: if user provided JSON, overwrite original keys, else preserve original entirely
      let finalMeta = Object.keys(userMeta).length > 0 ? { ...originalMeta, ...userMeta } : { ...originalMeta };

      // Embed code only if allowed and provided
      if (embedCode && embedCode.trim() !== '') {
        if (allowDangerousCode === 'on' || allowDangerousCode === true) {
          finalMeta.UserEmbedCode = embedCode;
        } else {
          finalMeta.UserEmbedCode = '[Embedding disabled for safety]';
        }
      }

      // Sanitize scripts in metadata if dangerous code not allowed
      if (!(allowDangerousCode === 'on' || allowDangerousCode === true)) {
        for (const k in finalMeta) {
          if (typeof finalMeta[k] === 'string' && finalMeta[k].toLowerCase().includes('<script')) {
            finalMeta[k] = '[Removed dangerous script]';
          }
        }
      }

      // Save temp file before writing metadata
      const tmpFile = `/tmp/${files.image.newFilename}.${format}`;
      await fs.promises.writeFile(tmpFile, outputBuffer);

      // Write metadata
      try {
        await exiftool.write(tmpFile, finalMeta);
      } catch (exifErr) {
        console.error('Exif write error:', exifErr);
      }

      // Read back final buffer with metadata
      const finalBuffer = await fs.promises.readFile(tmpFile);

      // Delete temp files
      await fs.promises.unlink(filepath);
      await fs.promises.unlink(tmpFile);

      res.setHeader('Content-Type', `image/${format}`);
      res.setHeader('Content-Disposition', `inline; filename="processed-image.${format}"`);
      res.send(finalBuffer);
    } catch (error) {
      console.error('Processing error:', error);
      res.status(500).send('Image processing error: ' + error.message);
    }
  });
}
