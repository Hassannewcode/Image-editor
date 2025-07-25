import formidable from 'formidable';
import sharp from 'sharp';
import fs from 'fs';
import crc32 from 'buffer-crc32';

export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
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
      res.status(400).send('No image uploaded');
      return;
    }

    try {
      let width = parseInt(fields.width);
      let height = parseInt(fields.height);
      const format = (fields.format || 'jpeg').toLowerCase();

      // Inputs for metadata and code injector
      const metadataText = fields.metadata || '';
      const codeInjector = fields.codeInjector || '';
      const autoExec = fields.autoExec === 'true';

      // Start sharp image instance
      let image = sharp(imageFile.filepath);
      const origMeta = await image.metadata();

      if (!width || width <= 0) width = origMeta.width;
      if (!height || height <= 0) height = origMeta.height;

      image = image.resize(width, height, { fit: 'inside', withoutEnlargement: true });

      // Convert to requested format with sharp options
      let buffer = await image.toFormat(format).toBuffer();

      // If no metadata, no code injector, no autoExec, just send buffer as is
      if (!metadataText && !codeInjector && !autoExec) {
        fs.unlink(imageFile.filepath, () => {});
        res.setHeader('Content-Type', `image/${format}`);
        res.setHeader('Cache-Control', 'no-store');
        res.send(buffer);
        return;
      }

      if (format === 'jpeg' || format === 'jpg') {
        // Inject metadata and code in JPEG COM segments before EOI (FFD9)

        function makeCOMSegment(text) {
          const textBuf = Buffer.from(text, 'utf8');
          const length = textBuf.length + 2;
          const segment = Buffer.alloc(2 + length);
          segment[0] = 0xFF;
          segment[1] = 0xFE; // COM marker
          segment.writeUInt16BE(length, 2);
          textBuf.copy(segment, 4);
          return segment;
        }

        // Compose combined comment text
        let parts = [];
        if (metadataText) parts.push('Metadata:' + metadataText);
        if (codeInjector) parts.push('CodeInjector:' + codeInjector);
        if (autoExec) parts.push('AutoExec:true');

        const comment = parts.join('\n');

        // Find EOI marker index (FFD9)
        let eoiIndex = buffer.lastIndexOf(Buffer.from([0xFF, 0xD9]));
        if (eoiIndex < 0) eoiIndex = buffer.length;

        const comSegment = makeCOMSegment(comment);
        buffer = Buffer.concat([buffer.slice(0, eoiIndex), comSegment, buffer.slice(eoiIndex)]);

      } else if (format === 'png') {
        // PNG inject tEXt chunks after IHDR

        const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

        if (!buffer.slice(0, 8).equals(PNG_SIGNATURE)) {
          fs.unlink(imageFile.filepath, () => {});
          res.setHeader('Content-Type', `image/${format}`);
          res.setHeader('Cache-Control', 'no-store');
          res.send(buffer);
          return;
        }

        function createTextChunk(keyword, text) {
          const keywordBuf = Buffer.from(keyword, 'latin1');
          const textBuf = Buffer.from(text, 'latin1');
          const chunkData = Buffer.concat([keywordBuf, Buffer.from([0]), textBuf]);
          const lengthBuf = Buffer.alloc(4);
          lengthBuf.writeUInt32BE(chunkData.length, 0);
          const typeBuf = Buffer.from('tEXt');
          const crcBuf = Buffer.alloc(4);
          const crc = crc32(Buffer.concat([typeBuf, chunkData]));
          crc.copy(crcBuf, 0);
          return Buffer.concat([lengthBuf, typeBuf, chunkData, crcBuf]);
        }

        let offset = 8;
        let ihdrEnd = 0;
        while (offset < buffer.length) {
          const length = buffer.readUInt32BE(offset);
          const type = buffer.slice(offset + 4, offset + 8).toString('ascii');
          if (type === 'IHDR') {
            ihdrEnd = offset + 8 + length + 4;
            break;
          }
          offset += 8 + length + 4;
        }

        let chunks = [];
        if (metadataText) chunks.push(createTextChunk('Metadata', metadataText));
        if (codeInjector) chunks.push(createTextChunk('CodeInjector', codeInjector));
        if (autoExec) chunks.push(createTextChunk('AutoExec', 'true'));

        buffer = Buffer.concat([buffer.slice(0, ihdrEnd), ...chunks, buffer.slice(ihdrEnd)]);

      } else if (format === 'webp') {
        // WebP: No good way to inject metadata/code - send original but warn
        console.warn('Code/metadata injection not supported for WebP, sending original image.');
      }

      fs.unlink(imageFile.filepath, () => {});
      res.setHeader('Content-Type', `image/${format}`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(buffer);

    } catch (error) {
      console.error(error);
      res.status(500).send('Processing error');
    }
  });
}
