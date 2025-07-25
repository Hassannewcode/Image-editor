import { IncomingForm } from 'formidable';
import fs from 'fs';
import sharp from 'sharp';
import { exiftool } from 'exiftool-vendored';

export const config = {
  api: {
    bodyParser: false, // Required for formidable
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

    const { width, height, format, metadata, quality, embedCode } = fields;

    try {
      const fileBuffer = await fs.promises.readFile(files.image.filepath);

      // Resize & convert
      let img = sharp(fileBuffer)
        .resize(parseInt(width), parseInt(height))
        .toFormat(format, { quality: parseInt(quality) });

      let outputBuffer = await img.toBuffer();

      // Prepare metadata JSON
      let metaJSON = {};
      if (metadata) {
        try {
          metaJSON = JSON.parse(metadata);
        } catch {
          return res.status(400).send('Invalid JSON metadata');
        }
      }

      // If embedCode is false/unchecked, sanitize scripts
      if (!embedCode || embedCode === 'false' || embedCode === undefined) {
        for (const key in metaJSON) {
          if (typeof metaJSON[key] === 'string' && metaJSON[key].toLowerCase().includes('<script')) {
            metaJSON[key] = '[Removed dangerous script]';
          }
        }
      }

      // Write metadata using exiftool (write to temp file)
      const tmpPath = `/tmp/${files.image.newFilename}.${format}`;
      await fs.promises.writeFile(tmpPath, outputBuffer);

      try {
        await exiftool.write(tmpPath, metaJSON);
      } catch (exifErr) {
        console.warn('Exiftool write error:', exifErr);
      }

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
