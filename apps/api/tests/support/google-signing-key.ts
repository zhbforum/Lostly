import { generateKeyPair } from 'jose';

// Keep the key in a cached support module: --rerun-each reloads test files,
// but the provider's cached JWKS survives those reloads.
export const googleSigningKey = generateKeyPair('RS256');
