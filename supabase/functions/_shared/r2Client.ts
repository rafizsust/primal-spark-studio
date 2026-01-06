// R2 upload using native fetch (Deno-compatible, no AWS SDK)

export const getR2Config = () => ({
  accountId: Deno.env.get("R2_ACCOUNT_ID") || "",
  accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID") || "",
  secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY") || "",
  bucketName: Deno.env.get("R2_BUCKET_NAME") || "",
  publicUrl: Deno.env.get("R2_PUBLIC_URL") || "",
});

// AWS Signature V4 implementation for R2
async function hmacSha256(key: ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

async function getSigningKey(keyBuffer: Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

async function sha256Hex(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256HexBytes(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getSignatureKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const kSecret = new TextEncoder().encode("AWS4" + secretKey);
  const kDate = await getSigningKey(kSecret, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return await hmacSha256(kService, "aws4_request");
}

export async function uploadToR2(
  key: string,
  body: Uint8Array,
  contentType: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  const config = getR2Config();
  
  if (!config.accountId || !config.accessKeyId || !config.secretAccessKey || !config.bucketName) {
    return { success: false, error: "R2 configuration incomplete" };
  }

  const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
  const url = `${endpoint}/${config.bucketName}/${key}`;
  const region = "auto";
  const service = "s3";

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = await sha256HexBytes(body);
  
  const canonicalHeaders = 
    `content-type:${contentType}\n` +
    `host:${config.accountId}.r2.cloudflarestorage.com\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  
  const canonicalRequest = 
    `PUT\n/${config.bucketName}/${key}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = 
    `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;

  const signingKey = await getSignatureKey(config.secretAccessKey, dateStamp, region, service);
  const signatureBuffer = await hmacSha256(signingKey, stringToSign);
  const signature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const authorizationHeader = 
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        "Authorization": authorizationHeader,
      },
      body: body.buffer as ArrayBuffer,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("R2 upload failed:", response.status, errorText);
      return { success: false, error: `R2 upload failed: ${response.status}` };
    }

    const publicUrl = `${config.publicUrl.replace(/\/$/, "")}/${key}`;
    return { success: true, url: publicUrl };
  } catch (error) {
    console.error("R2 upload error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function deleteFromR2(
  key: string
): Promise<{ success: boolean; error?: string }> {
  const config = getR2Config();
  
  if (!config.accountId || !config.accessKeyId || !config.secretAccessKey || !config.bucketName) {
    return { success: false, error: "R2 configuration incomplete" };
  }

  const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
  const url = `${endpoint}/${config.bucketName}/${key}`;
  const region = "auto";
  const service = "s3";

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  // Empty payload for DELETE
  const payloadHash = await sha256Hex("");
  
  const canonicalHeaders = 
    `host:${config.accountId}.r2.cloudflarestorage.com\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  
  const canonicalRequest = 
    `DELETE\n/${config.bucketName}/${key}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = 
    `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;

  const signingKey = await getSignatureKey(config.secretAccessKey, dateStamp, region, service);
  const signatureBuffer = await hmacSha256(signingKey, stringToSign);
  const signature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const authorizationHeader = 
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  try {
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        "Authorization": authorizationHeader,
      },
    });

    // R2 returns 204 No Content on successful delete
    if (!response.ok && response.status !== 204) {
      const errorText = await response.text();
      console.error("R2 delete failed:", response.status, errorText);
      return { success: false, error: `R2 delete failed: ${response.status}` };
    }

    return { success: true };
  } catch (error) {
    console.error("R2 delete error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
