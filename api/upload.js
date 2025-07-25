import { IncomingForm } from 'formidable';
import fs from 'fs';
import sharp from 'sharp';
import { exiftool } from 'exiftool-vendored';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  const form = new IncomingForm({ keepExtensions: true });

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
      // Read original image buffer
      const fileBuffer = await fs.promises.readFile(files.image.filepath);

      // Resize and convert
      let img = sharp(fileBuffer)
        .resize(parseInt(width), parseInt(height))
        .toFormat(format, { quality: parseInt(quality) });

      const outputBuffer = await img.toBuffer();

      // Read original metadata
      let originalMeta = {};
      try {
        originalMeta = await exiftool.read(files.image.filepath);
      } catch {
        originalMeta = {};
      }

      // Parse user metadata JSON if valid
      let metaJSON = {};
      if (metadata && metadata.trim() !== '') {
        try {
          metaJSON = JSON.parse(metadata);
        } catch {
          return res.status(400).send('Invalid JSON metadata');
        }
      }

      // Merge metadata ONLY if user provided some
      let finalMeta = {};
      if (Object.keys(metaJSON).length > 0) {
        finalMeta = { ...originalMeta, ...metaJSON };
      } else {
        // No user metadata given - preserve original metadata fully
        finalMeta = { ...originalMeta };
      }

      // Embed code only if provided and allowed
      if (embedCode && embedCode.trim() !== '') {
        if (allowDangerousCode === 'on' || allowDangerousCode === true) {
          finalMeta.UserEmbedCode = embedCode;
        } else {
          finalMeta.UserEmbedCode = '[Embedding disabled for safety]';
        }
      }

      // Sanitize scripts if dangerous code not allowed
      if (!allowDangerousCode || allowDangerousCode === 'false' || allowDangerousCode === undefined) {
        for (const key in finalMeta) {
          if (typeof finalMeta[key] === 'string' && finalMeta[key].toLowerCase().includes('<script')) {
            finalMeta[key] = '[Removed dangerous script]';
          }
        }
      }

      // Write to temp file first
      const tmpPath = `/tmp/${files.image.newFilename}.${format}`;
      await fs.promises.writeFile(tmpPath, outputBuffer);

      // Write metadata
      try {
        await exiftool.write(tmpPath, finalMeta);
      } catch (exifErr) {
        console.warn('Exiftool write error:', exifErr);
      }

      // Read final buffer and cleanup
      const finalBuffer = await fs.promises.readFile(tmpPath);
      await fs.promises.unlink(tmpPath);

      res.setHeader('Content-Type', `image/${format}`);
      res.send(finalBuffer);
    } catch (processErr) {
      console.error(processErr);
      res.status(500).send('Error processing image');
    }
  });
}
