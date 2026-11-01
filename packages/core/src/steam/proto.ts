import protobuf from 'protobufjs'

// The handful of Deadlock Game Coordinator messages we use. Field numbers
// from SteamDatabase/Protobufs (deadlock/citadel_gcmessages_client.proto and
// gcsdk_gcmessages.proto). Unused fields are omitted; protobuf ignores them.
const SCHEMA = `
syntax = "proto2";

message CMsgClientHello {
  optional uint32 client_session_need = 3;
  optional uint32 client_launcher = 4;
  optional uint32 engine = 7;
}

message CMsgClientToGCGetMatchHistory {
  optional uint32 account_id = 1;
  optional uint64 continue_cursor = 2;
}

message CMsgClientToGCGetMatchHistoryResponse {
  message Match {
    optional uint64 match_id = 1;
    optional uint32 hero_id = 2;
    optional uint32 match_duration_s = 3;
    optional uint32 start_time = 4;
    optional uint32 match_result = 5;
    optional uint32 player_team = 6;
    optional uint32 player_kills = 7;
    optional uint32 player_deaths = 8;
    optional uint32 player_assists = 9;
    optional uint32 last_hits = 11;
    optional uint32 denies = 12;
    optional uint32 hero_level = 13;
    optional uint32 net_worth = 14;
    optional uint32 abandoned_time_s = 18;
    optional uint32 match_mode = 19;
    optional uint32 game_mode = 20;
  }
  optional uint32 result = 1;
  optional uint64 continue_cursor = 2;
  repeated Match matches = 3;
}

message CMsgClientToGCGetMatchMetaData {
  optional uint64 match_id = 1;
  optional uint32 metadata_salt = 3;
  optional uint32 target_account_id = 4;
}

message CMsgClientToGCGetMatchMetaDataResponse {
  optional uint32 result = 1;
  optional uint32 replay_salt = 2;
  optional uint32 metadata_salt = 3;
  optional uint32 replay_valid_through = 4;
  optional uint32 replay_group_id = 5;
  optional uint32 replay_processing_through = 6;
}

// The file on Valve's replay servers ({match}_{salt}.meta.bz2), decompressed.
message CMsgMatchMetaData {
  optional uint32 version = 1;
  optional bytes match_details = 2;   // CMsgMatchMetaDataContents
  optional uint64 match_id = 3;
}

// Enums (team, game_mode, …) are declared uint32: same wire format, and we
// only want the numbers.
message CMsgMatchMetaDataContents {
  message Position {
    optional float x = 1;
    optional float y = 2;
    optional float z = 3;
  }
  message Deaths {
    optional uint32 game_time_s = 1;
    optional uint32 killer_player_slot = 9;
    optional Position death_pos = 10;
    optional uint32 death_duration_s = 12;
  }
  message Items {
    optional uint32 game_time_s = 1;
    optional uint32 item_id = 2;
    optional uint32 sold_time_s = 4;
  }
  message PlayerStats {
    optional uint32 time_stamp_s = 1;
    optional uint32 net_worth = 2;
    optional uint32 gold_player = 3;
    optional uint32 gold_player_orbs = 4;
    optional uint32 gold_lane_creep_orbs = 5;
    optional uint32 gold_neutral_creep_orbs = 6;
    optional uint32 gold_boss = 7;
    optional uint32 gold_boss_orb = 8;
    optional uint32 gold_treasure = 9;
    optional uint32 gold_denied = 10;
    optional uint32 gold_death_loss = 11;
    optional uint32 gold_lane_creep = 12;
    optional uint32 gold_neutral_creep = 13;
    optional uint32 kills = 14;
    optional uint32 deaths = 15;
    optional uint32 assists = 16;
    optional uint32 creep_kills = 17;
    optional uint32 neutral_kills = 18;
    optional uint32 possible_creeps = 19;
    optional uint32 player_damage = 21;
    optional uint32 boss_damage = 23;
    optional uint32 denies = 24;
    optional uint32 player_healing = 25;
    optional uint32 self_healing = 27;
    optional uint32 player_damage_taken = 28;
    optional uint32 shots_hit = 32;
    optional uint32 shots_missed = 33;
    optional uint32 hero_bullets_hit = 36;
    optional uint32 hero_bullets_hit_crit = 37;
    optional uint32 damage_mitigated = 42;
    optional uint32 level = 43;
  }
  message Players {
    optional uint32 account_id = 1;
    optional uint32 player_slot = 2;
    repeated Deaths death_details = 3;
    repeated Items items = 4;
    repeated PlayerStats stats = 5;
    optional uint32 team = 6;
    optional uint32 kills = 8;
    optional uint32 deaths = 9;
    optional uint32 assists = 10;
    optional uint32 net_worth = 11;
    optional uint32 hero_id = 12;
    optional uint32 last_hits = 13;
    optional uint32 denies = 14;
    optional uint32 assigned_lane = 17;
    optional uint32 level = 18;
    optional uint32 abandon_match_time_s = 23;
    optional uint32 mvp_rank = 28;
  }
  message Objective {
    optional uint32 destroyed_time_s = 2;
    optional uint32 first_damage_time_s = 8;
    optional uint32 team_objective_id = 9;   // ECitadelTeamObjective
    optional uint32 team = 10;               // owner of the objective
  }
  message MidBoss {
    optional uint32 team_killed = 1;
    optional uint32 team_claimed = 2;
    optional uint32 destroyed_time_s = 3;
  }
  message MatchInfo {
    optional uint32 duration_s = 1;
    optional uint32 match_outcome = 2;
    optional uint32 winning_team = 3;
    repeated Players players = 4;
    optional uint32 start_time = 5;
    optional uint64 match_id = 6;
    optional uint32 game_mode = 9;
    optional uint32 match_mode = 10;
    repeated Objective objectives = 11;
    repeated MidBoss mid_boss = 19;
    optional uint32 average_badge_team0 = 23;
    optional uint32 average_badge_team1 = 24;
  }
  optional MatchInfo match_info = 2;
}
`

const root = protobuf.parse(SCHEMA, { keepCase: true }).root

export const ClientHello = root.lookupType('CMsgClientHello')
export const GetMatchHistory = root.lookupType('CMsgClientToGCGetMatchHistory')
export const GetMatchHistoryResponse = root.lookupType('CMsgClientToGCGetMatchHistoryResponse')
export const GetMatchMetaData = root.lookupType('CMsgClientToGCGetMatchMetaData')
export const GetMatchMetaDataResponse = root.lookupType('CMsgClientToGCGetMatchMetaDataResponse')
export const MatchMetaData = root.lookupType('CMsgMatchMetaData')
export const MatchMetaDataContents = root.lookupType('CMsgMatchMetaDataContents')

/** Encode a message to the Buffer steam-user's sendToGC expects. */
export function encode(type: protobuf.Type, body: Record<string, unknown>): Buffer {
  return Buffer.from(type.encode(type.create(body)).finish())
}

/** Decode to a plain object; 64-bit ints become strings, missing fields get defaults. */
export function decode(type: protobuf.Type, payload: Buffer): unknown {
  return type.toObject(type.decode(payload), { longs: String, defaults: true, arrays: true })
}
