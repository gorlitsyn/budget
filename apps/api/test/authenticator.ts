/**
 * Программный passkey (ES256, attestation "none") для тестов: собирает ответы WebAuthn так же,
 * как браузер с платформенным аутентификатором. Проверка идёт настоящим SimpleWebAuthn.
 */
import crypto from 'node:crypto';
import { type CBORType, encodeCBOR } from '@levischuck/tiny-cbor';

const b64u = (b: Uint8Array | Buffer) => Buffer.from(b).toString('base64url');
const sha = (b: Uint8Array | string) => crypto.createHash('sha256').update(b).digest();

export class SoftAuthenticator {
  readonly credId = crypto.randomBytes(16);
  private keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  private counter = 0;
  userHandle: string | null = null;

  constructor(
    private rpId: string,
    private origin: string,
  ) {}

  private cosePublicKey(): Uint8Array {
    const jwk = this.keys.publicKey.export({ format: 'jwk' });
    return encodeCBOR(
      new Map<number, number | Uint8Array>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x!, 'base64url')],
        [-3, Buffer.from(jwk.y!, 'base64url')],
      ]),
    );
  }

  private authData(withCredential: boolean): Buffer {
    const UP = 0x01, UV = 0x04, BE = 0x08, BS = 0x10, AT = 0x40;
    const flags = UP | UV | BE | BS | (withCredential ? AT : 0);
    const count = Buffer.alloc(4);
    count.writeUInt32BE(++this.counter);
    const parts = [sha(this.rpId), Buffer.from([flags]), count];
    if (withCredential) {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(this.credId.length);
      parts.push(Buffer.alloc(16), len, this.credId, Buffer.from(this.cosePublicKey()));
    }
    return Buffer.concat(parts);
  }

  private clientData(type: string, challenge: string, origin = this.origin): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  /** Ответ на navigator.credentials.create(options). */
  create(options: { challenge: string; user: { id: string } }, origin?: string) {
    this.userHandle = options.user.id;
    const attestationObject = encodeCBOR(
      new Map<string, CBORType>([
        ['fmt', 'none'],
        ['attStmt', new Map<string, CBORType>()],
        ['authData', this.authData(true)],
      ]),
    );
    return {
      id: b64u(this.credId),
      rawId: b64u(this.credId),
      type: 'public-key',
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: b64u(this.clientData('webauthn.create', options.challenge, origin)),
        attestationObject: b64u(attestationObject),
        transports: ['internal', 'hybrid'],
      },
    };
  }

  /** Ответ на navigator.credentials.get(options). */
  get(options: { challenge: string }, origin?: string) {
    const authData = this.authData(false);
    const clientDataJSON = this.clientData('webauthn.get', options.challenge, origin);
    const signature = crypto.sign('sha256', Buffer.concat([authData, sha(clientDataJSON)]), this.keys.privateKey);
    return {
      id: b64u(this.credId),
      rawId: b64u(this.credId),
      type: 'public-key',
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
        userHandle: this.userHandle,
      },
    };
  }
}
