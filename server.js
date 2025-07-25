const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { exiftool } = require('exiftool-vendored');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

const upload = multer({ dest: 'uploads/' });

app.use(express.static(path.join(__dirname, 'public')));

app.post('/upload', upload.single('image'), async (req, res) => {
  const filePath = req.file.path;
  const { width, height, format, metadata, embedCode, embedCodeEnabled } = req.body;

  try {
    // Resize image with sharp
    let image = sharp(filePath);
    if (!width || !height) {
      const metadataOrig = await image.metadata();
      width = metadataOrig.width;
      height = metadataOrig.height;
    }
    let buffer = await image
      .resize(parseInt(width), parseInt(height))
      .toFormat(format || 'jpeg')
      .toBuffer();

    // Write metadata if provided
    if (metadata) {
      try {
        const jsonMetadata = JSON.parse(metadata);
        // Create temp file
        const tmpFile = `${filePath}_tmp.${format}`;
        await fs.promises.writeFile(tmpFile, buffer);
        // Write exif metadata
        await exiftool.write(tmpFile, jsonMetadata);
        buffer = await fs.promises.readFile(tmpFile);
        await fs.promises.unlink(tmpFile);
      } catch (exifErr) {
        console.error('Exif write error:', exifErr);
      }
    }

    // Optional embedCode (in a harmless text field for demo)
    // WARNING: embedding executable code in images is highly unsafe and generally unsupported.
    // Here we embed it as a text tag in metadata only if enabled.
    if (embedCodeEnabled === 'true' && embedCode) {
      try {
        const tmpFile2 = `${filePath}_embed.${format}`;
        await fs.promises.writeFile(tmpFile2, buffer);
        await exiftool.write(tmpFile2, { UserComment: embedCode });
        buffer = await fs.promises.readFile(tmpFile2);
        await fs.promises.unlink(tmpFile2);
      } catch (embedErr) {
        console.error('Embed code exif write error:', embedErr);
      }
    }

    // Delete original upload
    await fs.promises.unlink(filePath);

    res.setHeader('Content-Type', `image/${format || 'jpeg'}`);
    res.setHeader('Content-Disposition', `attachment; filename=processed-image.${format || 'jpeg'}`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).send('Image processing error: ' + err.message);
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
