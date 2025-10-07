const fetch = require('node-fetch');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

// B2 Authorization helper
async function getB2Auth() {
  const authString = Buffer.from(`${process.env.B2_KEY_ID}:${process.env.B2_SECRET}`).toString('base64');
  const authResponse = await fetch(
    'https://api.backblazeb2.com/b2api/v2/b2_authorize_account',
    {
      headers: {
        Authorization: `Basic ${authString}`
      }
    }
  );

  if (!authResponse.ok) {
    throw new Error(`B2 Auth failed: ${authResponse.status}`);
  }

  return await authResponse.json();
}

// Download file from B2
async function downloadFromB2(fileName, authToken, downloadUrl) {
  const tmpPath = path.join(os.tmpdir(), `video-${Date.now()}`);
  const writer = fs.createWriteStream(tmpPath);

  const response = await axios({
    method: 'GET',
    url: `${downloadUrl}/file/Lizard/${fileName}`,
    headers: {
      Authorization: authToken
    },
    responseType: 'stream'
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(tmpPath));
    writer.on('error', reject);
  });
}

// Generate thumbnail
function generateThumbnail(videoPath, thumbnailPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ['00:00:01.000'],
        filename: path.basename(thumbnailPath),
        folder: path.dirname(thumbnailPath),
        size: '320x240',
      })
      .on('end', () => resolve(thumbnailPath))
      .on('error', err => reject(err));
  });
}

// Upload to B2 using Native API
async function uploadToB2(fileName, filePath, contentType) {
  const { authorizationToken, apiUrl, downloadUrl } = await getB2Auth();

  // Get upload URL
  const uploadUrlResponse = await axios.post(
    `${apiUrl}/b2api/v2/b2_get_upload_url`,
    { bucketId: process.env.B2_BUCKET_ID },
    {
      headers: {
        Authorization: authorizationToken
      }
    }
  );

  const { uploadUrl, authorizationToken: uploadToken } = uploadUrlResponse.data;

  // Read file
  const fileBuffer = fs.readFileSync(filePath);
  
  // Calculate SHA1
  const sha1 = crypto.createHash('sha1').update(fileBuffer).digest('hex');

  // Upload file
  const uploadResponse = await axios.post(uploadUrl, fileBuffer, {
    headers: {
      'Authorization': uploadToken,
      'X-Bz-File-Name': encodeURIComponent(fileName),
      'Content-Type': contentType,
      'Content-Length': fileBuffer.length,
      'X-Bz-Content-Sha1': sha1
    }
  });

  return {
    fileName: uploadResponse.data.fileName,
    fileId: uploadResponse.data.fileId,
    url: `${downloadUrl}/file/Lizard/${fileName}`
  };
}

module.exports = handler;

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(200).end();
    return;
  }

  // Apply CORS headers for POST
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { key: videoKey, userId, title, description } = req.body;
    if (!videoKey || !userId) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    // Get B2 auth
    const { authorizationToken, downloadUrl } = await getB2Auth();

    // 1. Download uploaded video from B2
    const tempVideoPath = await downloadFromB2(videoKey, authorizationToken, downloadUrl);

    // 2. Generate thumbnail
    const thumbnailPath = path.join(os.tmpdir(), `thumb-${Date.now()}.png`);
    await generateThumbnail(tempVideoPath, thumbnailPath);

    // 3. Generate keys
    const metaTimestamp = Date.now();
    const thumbKey = `thumb-${userId}-${metaTimestamp}.png`;
    const metaKey = `meta-${userId}-${metaTimestamp}.json`;

    // 4. Upload thumbnail to B2
    const thumbUpload = await uploadToB2(thumbKey, thumbnailPath, 'image/png');

    // 5. Build metadata object
    const metadata = {
      id: `${userId}-${metaTimestamp}`,
      userId,
      title,
      description,
      uploadedAt: new Date().toISOString(),
      videoUrl: `${downloadUrl}/file/Lizard/${videoKey}`,
      thumbnailUrl: thumbUpload.url,
      hearts: 0,
      comments: 0,
      views: 0
    };

    // 6. Upload metadata JSON to B2
    const metadataJsonPath = path.join(os.tmpdir(), `meta-${Date.now()}.json`);
    fs.writeFileSync(metadataJsonPath, JSON.stringify(metadata));
    await uploadToB2(metaKey, metadataJsonPath, 'application/json');

    // Clean up temp files
    fs.unlinkSync(tempVideoPath);
    fs.unlinkSync(thumbnailPath);
    fs.unlinkSync(metadataJsonPath);

    res.status(200).json({ success: true, short: metadata });
  } catch (error) {
    console.error('Error in saveMetadata:', error);
    res.status(500).json({ 
      error: 'Failed in metadata', 
      details: error.response?.data || error.message 
    });
  }
}
