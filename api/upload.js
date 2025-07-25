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
      console.error('Form parse error:', err);
      res.status(500).send('Form parse error');
      return;
    }

    const file = files.image;
    if (!file) {
      res.status(400).send('No image file uploaded');
      return;
    }

    const { width, height, format, metadata } = fields;

    try {
      const buffer = await fs.promises.readFile(file.filepath);

      let outputBuffer = await sharp(buffer)
        .resize(parseInt(width), parseInt(height))
        .toFormat(format)
        .toBuffer();

      if (metadata) {
        const tempPath = `/tmp/${file.newFilename}.${format}`;
        await fs.promises.writeFile(tempPath, outputBuffer);

        try {
          const jsonMetadata = JSON.parse(metadata);
          await exiftool.write(tempPath, jsonMetadata);
        } catch (metaErr) {
          console.warn('Metadata JSON parse or write error:', metaErr);
          // Continue without failing on metadata error
        }

        outputBuffer = await fs.promises.readFile(tempPath);
        await fs.promises.unlink(tempPath);
      }

      res.setHeader('Content-Type', `image/${format}`);
      res.send(outputBuffer);
    } catch (procErr) {
      console.error('Image processing error:', procErr);
      res.status(500).send('Image processing error');
    }
  });
}
