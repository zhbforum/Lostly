export interface PageInfo {
  endCursor: string | null;
  hasNextPage: boolean;
}

export interface PageQuery {
  cursor?: string;
  limit?: number;
}
