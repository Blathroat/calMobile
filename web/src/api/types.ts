export type Id = string;
export type JsonObject = Record<string, unknown>;

export interface AuthResult extends JsonObject {
  token?: string;
  refreshToken?: string;
}

export interface User extends JsonObject {
  id?: string;
  username?: string;
  nickname?: string;
  role?: string;
  status?: string;
}

export interface Bootstrap extends JsonObject {
  user?: User;
  loggedIn?: boolean;
}

export interface Exhibition extends JsonObject {
  id: Id;
  title: string;
  date?: string;
}

export interface Registration extends JsonObject { id: Id; status?: string; }
export interface ApiResult extends JsonObject { ok?: boolean; error?: string; }
