import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import crypto from 'crypto';
import fetch from 'node-fetch';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';

ffmpeg.setFfmpegPath(ffmpegStatic);

// Helper: get B2 auth
async function getB2Auth() {
  const authString = Buffer.from(`${process.env.B2_KEY_ID}:${process.env.B2_SECRET}`).toString('base64');
  const authResponse = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: {
      Authorization: `Basic ${authString}`
    }
  });
  if (!authResponse.ok) {
    const txt = await authResponse.text();
    throw new Error(`B2 Auth failed: ${authResponse.status} ${txt}`);
  }
  return authResponse.json();
}

// Helper: download file from B2 (Native API)
async function downloadFromB2(fileKey, authorizationToken, downloadUrl) {
  const tmpPath = path.join(os.tmpdir(), `video-${Date.now()}`);
  const writer = fs.createWriteStream(tmpPath);

  // The URL for file download in B2 native is: <downloadUrl>/file/<bucketName>/<fileKey>
  const url = `${downloadUrl}/file/${process.env.B2_BUCKET_NAME}/${fileKey}`;
  const response = await axios({
    method: 'GET',
    url,
    headers: {
      Authorization: authorizationToken
    },
    responseType: 'stream'
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(tmpPath));
    writer.on('error', reject);
  });
}

// Helper: generate thumbnail
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
      .on('error', (err) => reject(err));
  });
}

// Helper: upload a local file to B2 using native API
async function uploadToB2(fileKey, localFilePath, contentType) {
  const auth = await getB2Auth();
  const { authorizationToken, apiUrl, downloadUrl } = auth;

  // Get upload URL
  const uploadUrlResp = await axios.post(
    `${apiUrl}/b2api/v2/b2_get_upload_url`,
    { bucketId: process.env.B2_BUCKET_ID },
    {
      headers: {
        Authorization: authorizationToken,
        'Content-Type': 'application/json'
      }
    }
  );
  if (uploadUrlResp.status !== 200) {
    throw new Error(`Failed get upload URL: ${uploadUrlResp.status} ${JSON.stringify(uploadUrlResp.data)}`);
  }

  const { uploadUrl, authorizationToken: uploadToken } = uploadUrlResp.data;

  const fileBuffer = await promisify(fs.readFile)(localFilePath);
  const sha1 = crypto.createHash('sha1').update(fileBuffer).digest('hex');

  const uploadResp = await axios.post(uploadUrl, fileBuffer, {
    headers: {
      Authorization: uploadToken,
      'X-Bz-File-Name': encodeURIComponent(fileKey),
      'Content-Type': contentType,
      'Content-Length': fileBuffer.length,
      'X-Bz-Content-Sha1': sha1
    }
  });

  if (uploadResp.status !== 200) {
    throw new Error(`Upload to B2 failed: ${uploadResp.status} ${JSON.stringify(uploadResp.data)}`);
  }

  return {
    fileName: uploadResp.data.fileName,
    fileId: uploadResp.data.fileId,
    url: `${downloadUrl}/file/${process.env.B2_BUCKET_NAME}/${fileKey}`
  };
}

// The actual API handler
export default async function handler(req, res) {
  // CORS preflight handling
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        console.error('Invalid JSON in request body:', body);
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }

    const { key: videoKey, userId, title, description } = body;
    if (!videoKey || !userId) {
      console.warn('Missing videoKey or userId', body);
      return res.status(400).json({ error: 'Missing parameters' });
    }

    console.log('saveMetadata: downloading video from B2:', videoKey);

    const auth = await getB2Auth();
    const { authorizationToken, downloadUrl } = auth;

    const tempVideoPath = await downloadFromB2(videoKey, authorizationToken, downloadUrl);

    console.log('saveMetadata: generating thumbnail');
    const thumbnailPath = path.join(os.tmpdir(), `thumb-${Date.now()}.png`);
    await generateThumbnail(tempVideoPath, thumbnailPath);

    const metaTimestamp = Date.now();
    const thumbKey = `thumb-${userId}-${metaTimestamp}.png`;
    const metaKey = `meta-${userId}-${metaTimestamp}.json`;

    console.log('saveMetadata: uploading thumbnail');
    const thumbUpload = await uploadToB2(thumbKey, thumbnailPath, 'image/png');

    console.log('saveMetadata: building metadata and uploading JSON');
    const metadata = {
      id: `${userId}-${metaTimestamp}`,
      userId,
      title: title || '',
      description: description || '',
      uploadedAt: new Date().toISOString(),
      videoUrl: `${downloadUrl}/file/${process.env.B2_BUCKET_NAME}/${videoKey}`,
      thumbnailUrl: thumbUpload.url,
      hearts: 0,
      comments: 0,
      views: 0
    };

    const metaJsonPath = path.join(os.tmpdir(), `meta-${Date.now()}.json`);
    await promisify(fs.writeFile)(metaJsonPath, JSON.stringify(metadata));

    await uploadToB2(metaKey, metaJsonPath, 'application/json');

    // Clean up local temp files
    try {
      fs.unlinkSync(tempVideoPath);
      fs.unlinkSync(thumbnailPath);
      fs.unlinkSync(metaJsonPath);
    } catch (cleanupErr) {
      console.warn('Cleanup error:', cleanupErr);
    }

    return res.status(200).json({ success: true, short: metadata });

  } catch (err) {
    console.error('Error in saveMetadata handler:', err);
    // If axios error with `response` object, include that
    const details = err.response?.data || err.message;
    return res.status(500).json({ error: 'Failed in metadata', details });
  }
}

// Disable Next.js body parsing because we're handling streams/files
export const config = {
  api: {
    bodyParser: false
  }
};
