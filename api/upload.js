import formidable from 'formidable';
import sharp from 'sharp';
import fs from 'fs';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Only POST allowed');
    return;
  }

  const form = new formidable.IncomingForm();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      res.status(500).send('Error parsing form');
      return;
    }

    const imageFile = files.image;
    if (!imageFile) {
      res.status(400).send('Image file is required');
      return;
    }

    try {
      let width = parseInt(fields.width);
      let height = parseInt(fields.height);
      const format = (fields.format || 'jpeg').toLowerCase();
      const metadataText = fields.metadata || '';

      // Load image and get original dimensions
      let image = sharp(imageFile.filepath);
      const origMeta = await image.metadata();

      // Auto-adjust width/height if empty or invalid
      if (!width || width <= 0) width = origMeta.width;
      if (!height || height <= 0) height = origMeta.height;

      image = image.resize(width, height, { fit: 'inside', withoutEnlargement: true });

      // Prepare output options & embed metadata (comment or text chunk)
      const outputOptions = {};
      if (format === 'jpeg') {
        outputOptions.mozjpeg = true;
        if (metadataText) {
          outputOptions.comment = metadataText;
        }
      } else if (format === 'png') {
        if (metadataText) {
          outputOptions.text = { Description: metadataText };
        }
      }
      // webp doesn't support metadata embedding well in sharp, skip

      const buffer = await image.toFormat(format, outputOptions).toBuffer();

      // Clean up uploaded temp file
      fs.unlink(imageFile.filepath, () => {});

      res.setHeader('Content-Type', `image/${format}`);
      res.setHeader('Cache-Control', 'no-store'); // prevent caching for test
      res.send(buffer);
    } catch (error) {
      console.error(error);
      res.status(500).send('Image processing error');
    }
  });
}
