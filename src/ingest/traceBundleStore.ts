export interface StoreTraceBundleRequest {
  teamId: string;
  sessionId: string;
  contentSha256: string;
  receivedAtUtc: string;

  bodyGzip: Buffer;

  contentType: string;
  contentEncoding: string;

  clientId?: string;
  source?: string;
  schemaVersion?: string;
  userAgent?: string;
}

export interface StoreTraceBundleResult {
  storedKey: string;
  duplicate: boolean;
}

export interface TraceBundleStore {
  storeTraceBundle(request: StoreTraceBundleRequest): Promise<StoreTraceBundleResult>;
}
