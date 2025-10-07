const fetch = require('node-fetch');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  try {
    console.log('=== Upload Proxy Called ===');
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Get parameters from query string
    const { uploadUrl, uploadToken, key, contentType } = req.query;
    
    console.log('Upload params:', { uploadUrl: uploadUrl?.substring(0, 50), key, contentType });

    if (!uploadUrl || !uploadToken || !key || !contentType) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    // Read video file from request
    const buffers = [];
    for await (const chunk of req) {
      buffers.push(chunk);
    }
    const fileBuffer = Buffer.concat(buffers);
    
    console.log('File size:', fileBuffer.length, 'bytes');

    // Calculate SHA1
    const sha1 = crypto.createHash('sha1').update(fileBuffer).digest('hex');
    console.log('SHA1:', sha1);

    // Upload to B2
    console.log('Uploading to B2...');
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': uploadToken,
        'X-Bz-File-Name': encodeURIComponent(key),
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length.toString(),
        'X-Bz-Content-Sha1': sha1
      },
      body: fileBuffer
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('B2 upload failed:', errorText);
      throw new Error(`B2 upload failed: ${uploadResponse.status}`);
    }

    const result = await uploadResponse.json();
    console.log('Upload successful:', result.fileName);

    return res.status(200).json({ 
      success: true,
      fileName: result.fileName,
      fileId: result.fileId
    });

  } catch (error) {
    console.error('Upload proxy error:', error.message);
    return res.status(500).json({ 
      error: 'Upload failed',
      details: error.message 
    });
  }
}

// Disable body parsing to handle binary data
module.exports.config = {
  api: {
    bodyParser: false,
    responseLimit: '50mb', // Allow up to 50MB videos
  },
};
