//! LLM call path and validation gate.
//!
//! The gate is the feature; the HTTP call is plumbing. Progress numbers never
//! leave this module as data the UI could render as fill height.

use std::sync::LazyLock;
use std::time::{Duration, Instant};

#[cfg(test)]
use std::collections::HashMap;
#[cfg(test)]
use std::sync::Mutex;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

const KEYCHAIN_SERVICE: &str = "dev.tinman.workbench";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Purpose {
    MapArchitecture,
    AdvisePart,
    DraftGoal,
    VerifyDelivery,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    OpenaiCompatible,
    Ollama,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProviderConfig {
    pub id: String,
    pub kind: ProviderKind,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub key_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FrameworkAdvice {
    pub diagnosis: String,
    pub next_step: String,
    pub entry_point: String,
    pub shared_risk: String,
    pub done_criteria: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RejectionReason {
    ContainsCode,
    ContainsProgressNumber,
    MissingField,
    UnsourcedClaim,
    NotJson,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rejection {
    pub reason: RejectionReason,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Validated {
    AdvisePart(FrameworkAdvice),
    Other(Value),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnavailableReason {
    NoKey,
    NoProfile,
    Offline,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum LlmCallResult {
    Available {
        purpose: Purpose,
        advice: Option<FrameworkAdvice>,
        output: Value,
        call_id: String,
        duration_ms: u64,
    },
    Unavailable {
        reason: UnavailableReason,
        detail: Option<String>,
        reject_reason: Option<RejectionReason>,
        call_id: Option<String>,
        duration_ms: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CallLogEntry {
    pub id: String,
    pub workspace_id: String,
    pub purpose: String,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub request_json: String,
    pub response_text: Option<String>,
    pub verdict: String,
    pub reject_reason: Option<String>,
    pub duration_ms: u64,
    pub created_at: String,
}

#[derive(Debug)]
pub struct InvalidPurpose;

impl std::fmt::Display for InvalidPurpose {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "unknown llm purpose")
    }
}

pub struct CallOutcome {
    pub result: Result<LlmCallResult, InvalidPurpose>,
    pub log: Option<CallLogEntry>,
}

pub struct CallDeps<'a> {
    pub workspace_id: &'a str,
    pub profile_id: Option<&'a str>,
    pub profiles: &'a [ProviderConfig],
    pub keys: &'a dyn KeyStore,
    pub clock: &'a dyn Clock,
}

pub trait Clock {
    fn now_rfc3339(&self) -> String;
}

pub struct LiveClock;

impl Clock for LiveClock {
    fn now_rfc3339(&self) -> String {
        chrono::Utc::now().to_rfc3339()
    }
}

pub enum KeyLookup {
    Found(String),
    Missing,
    Failed,
}

pub trait KeyStore {
    fn get(&self, key_ref: &str) -> KeyLookup;
    fn set(&self, key_ref: &str, secret: &str) -> Result<(), String>;
}

#[cfg(test)]
#[derive(Default)]
pub struct MemoryKeys {
    inner: Mutex<HashMap<String, String>>,
}

#[cfg(test)]
impl MemoryKeys {
    pub fn insert(&self, key_ref: &str, secret: &str) {
        self.inner
            .lock()
            .expect("memory key store")
            .insert(key_ref.to_string(), secret.to_string());
    }
}

#[cfg(test)]
impl KeyStore for MemoryKeys {
    fn get(&self, key_ref: &str) -> KeyLookup {
        match self.inner.lock().expect("memory key store").get(key_ref) {
            Some(v) => KeyLookup::Found(v.clone()),
            None => KeyLookup::Missing,
        }
    }

    fn set(&self, key_ref: &str, secret: &str) -> Result<(), String> {
        self.insert(key_ref, secret);
        Ok(())
    }
}

pub struct OsKeychain;

impl KeyStore for OsKeychain {
    fn get(&self, key_ref: &str) -> KeyLookup {
        let entry = match keyring::Entry::new(KEYCHAIN_SERVICE, key_ref) {
            Ok(e) => e,
            Err(_) => return KeyLookup::Failed,
        };
        match entry.get_password() {
            Ok(p) => KeyLookup::Found(p),
            Err(keyring::Error::NoEntry) => KeyLookup::Missing,
            Err(_) => KeyLookup::Failed,
        }
    }

    fn set(&self, key_ref: &str, secret: &str) -> Result<(), String> {
        if secret.is_empty() {
            return Err("empty key".into());
        }
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, key_ref)
            .map_err(|_| "keychain unavailable".to_string())?;
        entry
            .set_password(secret)
            .map_err(|_| "keychain unavailable".to_string())
    }
}

#[derive(Debug, Clone)]
pub enum TransportError {
    Offline(String),
    Http(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

pub struct ChatRequest {
    pub base_url: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    authorization: Option<String>,
}

impl std::fmt::Debug for ChatRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChatRequest")
            .field("base_url", &self.base_url)
            .field("model", &self.model)
            .field("messages", &self.messages)
            .field(
                "authorization",
                &self.authorization.as_ref().map(|_| "[redacted]"),
            )
            .finish()
    }
}

pub trait Transport {
    fn complete(&self, req: &ChatRequest) -> Result<String, TransportError>;
}

pub struct HttpTransport {
    client: reqwest::blocking::Client,
}

impl HttpTransport {
    pub fn new() -> Result<Self, TransportError> {
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(45))
            .build()
            .map_err(|e| TransportError::Offline(e.to_string()))?;
        Ok(Self { client })
    }
}

impl Transport for HttpTransport {
    fn complete(&self, req: &ChatRequest) -> Result<String, TransportError> {
        let url = completions_url(&req.base_url);
        let body = json!({
            "model": req.model,
            "messages": req.messages,
            "temperature": 0
        });
        let mut builder = self.client.post(&url).json(&body);
        if let Some(key) = &req.authorization {
            builder = builder.bearer_auth(key);
        }
        let resp = builder.send().map_err(|e| {
            let msg = scrub(&e.to_string(), req.authorization.as_deref());
            if e.is_connect() || e.is_timeout() || e.is_request() {
                TransportError::Offline(msg)
            } else {
                TransportError::Http(msg)
            }
        })?;
        let status = resp.status();
        let text = resp
            .text()
            .map_err(|e| TransportError::Http(scrub(&e.to_string(), req.authorization.as_deref())))?;
        let text = scrub(&text, req.authorization.as_deref());
        if !status.is_success() {
            return Err(TransportError::Offline(format!("http {status}")));
        }
        Ok(extract_assistant_content(&text))
    }
}

pub fn profiles_from_prefs(prefs: &Value) -> Vec<ProviderConfig> {
    let Some(Value::Array(arr)) = prefs.get("llm_profiles") else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|v| serde_json::from_value(v.clone()).ok())
        .collect()
}

pub fn parse_purpose(wire: &str) -> Result<Purpose, InvalidPurpose> {
    serde_json::from_value(Value::String(wire.to_string())).map_err(|_| InvalidPurpose)
}

/// Single call path. `purpose` is deserialized first; an unknown value never
/// constructs a transport and never performs I/O.
pub fn call<F, T>(
    purpose_wire: &str,
    input: &Value,
    deps: &CallDeps<'_>,
    make_transport: F,
) -> CallOutcome
where
    F: FnOnce() -> Result<T, TransportError>,
    T: Transport,
{
    let purpose = match parse_purpose(purpose_wire) {
        Ok(p) => p,
        Err(e) => {
            return CallOutcome {
                result: Err(e),
                log: None,
            };
        }
    };
    let t0 = Instant::now();
    let call_id = Uuid::new_v4().to_string();
    let created_at = deps.clock.now_rfc3339();

    let Some(profile) = resolve_profile(deps.profiles, deps.profile_id) else {
        return finish_unavailable(
            purpose,
            UnavailableReason::NoProfile,
            None,
            None,
            None,
            input,
            deps,
            call_id,
            t0,
            created_at,
            None,
        );
    };

    let messages = build_messages(purpose, input);
    let secret = match profile.kind {
        ProviderKind::Ollama => None,
        ProviderKind::OpenaiCompatible => {
            let key_ref = profile
                .key_ref
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty());
            let Some(key_ref) = key_ref else {
                return finish_unavailable(
                    purpose,
                    UnavailableReason::NoKey,
                    None,
                    Some(profile),
                    Some(&messages),
                    input,
                    deps,
                    call_id,
                    t0,
                    created_at,
                    None,
                );
            };
            match deps.keys.get(key_ref) {
                KeyLookup::Found(s) => Some(s),
                KeyLookup::Missing => {
                    return finish_unavailable(
                        purpose,
                        UnavailableReason::NoKey,
                        None,
                        Some(profile),
                        Some(&messages),
                        input,
                        deps,
                        call_id,
                        t0,
                        created_at,
                        None,
                    );
                }
                KeyLookup::Failed => {
                    return finish_unavailable(
                        purpose,
                        UnavailableReason::Offline,
                        Some("keychain unavailable".into()),
                        Some(profile),
                        Some(&messages),
                        input,
                        deps,
                        call_id,
                        t0,
                        created_at,
                        None,
                    );
                }
            }
        }
    };

    let transport = match make_transport() {
        Ok(t) => t,
        Err(e) => {
            let detail = scrub(&transport_detail(&e), secret.as_deref());
            return finish_unavailable(
                purpose,
                UnavailableReason::Offline,
                Some(detail),
                Some(profile),
                Some(&messages),
                input,
                deps,
                call_id,
                t0,
                created_at,
                secret.as_deref(),
            );
        }
    };

    let req = ChatRequest {
        base_url: profile.base_url.clone(),
        model: profile.model.clone(),
        messages: messages.clone(),
        authorization: secret.clone(),
    };
    let raw = match transport.complete(&req) {
        Ok(s) => scrub(&s, secret.as_deref()),
        Err(e) => {
            let detail = scrub(&transport_detail(&e), secret.as_deref());
            return finish_unavailable(
                purpose,
                UnavailableReason::Offline,
                Some(detail),
                Some(profile),
                Some(&messages),
                input,
                deps,
                call_id,
                t0,
                created_at,
                secret.as_deref(),
            );
        }
    };

    match validate(purpose, &raw, input) {
        Ok(validated) => {
            let duration_ms = t0.elapsed().as_millis() as u64;
            let (advice, output) = match validated {
                Validated::AdvisePart(a) => {
                    let output = serde_json::to_value(&a).unwrap_or(Value::Null);
                    (Some(a), output)
                }
                Validated::Other(v) => (None, v),
            };
            let log = Some(log_row(
                &call_id,
                deps.workspace_id,
                purpose,
                Some(profile),
                Some(&messages),
                input,
                Some(&raw),
                "accepted",
                None,
                duration_ms,
                &created_at,
                secret.as_deref(),
            ));
            CallOutcome {
                result: Ok(LlmCallResult::Available {
                    purpose,
                    advice,
                    output,
                    call_id,
                    duration_ms,
                }),
                log,
            }
        }
        Err(rejection) => {
            let duration_ms = t0.elapsed().as_millis() as u64;
            let reason_wire = serde_json::to_value(rejection.reason)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string));
            let log = Some(log_row(
                &call_id,
                deps.workspace_id,
                purpose,
                Some(profile),
                Some(&messages),
                input,
                Some(&raw),
                "rejected",
                reason_wire.as_deref(),
                duration_ms,
                &created_at,
                secret.as_deref(),
            ));
            CallOutcome {
                result: Ok(LlmCallResult::Unavailable {
                    reason: UnavailableReason::Rejected,
                    detail: Some(rejection.detail),
                    reject_reason: Some(rejection.reason),
                    call_id: Some(call_id),
                    duration_ms,
                }),
                log,
            }
        }
    }
}

fn finish_unavailable(
    purpose: Purpose,
    reason: UnavailableReason,
    detail: Option<String>,
    profile: Option<&ProviderConfig>,
    messages: Option<&[ChatMessage]>,
    input: &Value,
    deps: &CallDeps<'_>,
    call_id: String,
    t0: Instant,
    created_at: String,
    secret: Option<&str>,
) -> CallOutcome {
    let duration_ms = t0.elapsed().as_millis() as u64;
    let reason_wire = serde_json::to_value(reason)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string));
    let log = Some(log_row(
        &call_id,
        deps.workspace_id,
        purpose,
        profile,
        messages,
        input,
        None,
        "unavailable",
        reason_wire.as_deref(),
        duration_ms,
        &created_at,
        secret,
    ));
    CallOutcome {
        result: Ok(LlmCallResult::Unavailable {
            reason,
            detail,
            reject_reason: None,
            call_id: Some(call_id),
            duration_ms,
        }),
        log,
    }
}

fn log_row(
    id: &str,
    workspace_id: &str,
    purpose: Purpose,
    profile: Option<&ProviderConfig>,
    messages: Option<&[ChatMessage]>,
    input: &Value,
    response_text: Option<&str>,
    verdict: &str,
    reject_reason: Option<&str>,
    duration_ms: u64,
    created_at: &str,
    secret: Option<&str>,
) -> CallLogEntry {
    let purpose_s = serde_json::to_value(purpose)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| format!("{purpose:?}"));
    let payload = json!({
        "purpose": purpose,
        "model": profile.map(|p| &p.model),
        "messages": messages,
        "input": input,
    });
    CallLogEntry {
        id: id.to_string(),
        workspace_id: workspace_id.to_string(),
        purpose: purpose_s,
        provider_id: profile.map(|p| p.id.clone()),
        model: profile.map(|p| p.model.clone()),
        request_json: scrub(&payload.to_string(), secret),
        response_text: response_text.map(|s| scrub(s, secret)),
        verdict: verdict.to_string(),
        reject_reason: reject_reason.map(|s| s.to_string()),
        duration_ms,
        created_at: created_at.to_string(),
    }
}

fn resolve_profile<'a>(
    profiles: &'a [ProviderConfig],
    id: Option<&str>,
) -> Option<&'a ProviderConfig> {
    let id = id.map(str::trim).filter(|s| !s.is_empty())?;
    profiles.iter().find(|p| p.id == id)
}

fn transport_detail(err: &TransportError) -> String {
    match err {
        TransportError::Offline(s) | TransportError::Http(s) => s.clone(),
    }
}

fn completions_url(base: &str) -> String {
    let b = base.trim().trim_end_matches('/');
    if b.ends_with("/chat/completions") {
        b.to_string()
    } else {
        format!("{b}/chat/completions")
    }
}

fn extract_assistant_content(body: &str) -> String {
    let Ok(v) = serde_json::from_str::<Value>(body) else {
        return body.to_string();
    };
    let Some(content) = v
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
    else {
        return body.to_string();
    };
    match content {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join(""),
        other => other.to_string(),
    }
}

fn build_messages(purpose: Purpose, input: &Value) -> Vec<ChatMessage> {
    vec![
        ChatMessage {
            role: "system".into(),
            content: system_prompt(purpose).into(),
        },
        ChatMessage {
            role: "user".into(),
            content: input.to_string(),
        },
    ]
}

fn system_prompt(purpose: Purpose) -> &'static str {
    match purpose {
        Purpose::AdvisePart => {
            "Return one JSON object and nothing else. No markdown fences, no code, no diffs, no progress numbers. \
             Keys: diagnosis, next_step, entry_point, shared_risk, done_criteria (3 to 5 strings). \
             diagnosis must cite a file, test, date, or commit from the facts, or say 事实不足."
        }
        Purpose::MapArchitecture => {
            "Return one JSON object and nothing else. No markdown fences, no code, no progress numbers. \
             Propose module-to-slot mapping, wires, and draft criteria from the facts."
        }
        Purpose::DraftGoal => {
            "Return one JSON object and nothing else. No markdown fences, no code, no progress numbers. \
             Fill framework_advice and done_criteria from the facts."
        }
        Purpose::VerifyDelivery => {
            "Return one JSON object and nothing else. No markdown fences, no code, no progress numbers. \
             Check the delivery against done_criteria using the facts. Do not invent progress."
        }
    }
}

pub fn scrub(text: &str, secret: Option<&str>) -> String {
    match secret {
        Some(s) if !s.is_empty() => text.replace(s, "[redacted]"),
        _ => text.to_string(),
    }
}

pub fn validate(purpose: Purpose, raw: &str, facts: &Value) -> Result<Validated, Rejection> {
    if let Some(reason) = forbidden_in_text(raw) {
        return Err(Rejection {
            reason,
            detail: rejection_detail(reason, None),
        });
    }
    let trimmed = raw.trim();
    let value: Value = serde_json::from_str(trimmed).map_err(|_| Rejection {
        reason: RejectionReason::NotJson,
        detail: rejection_detail(RejectionReason::NotJson, None),
    })?;
    if let Some(reason) = forbidden_in_json(&value) {
        return Err(Rejection {
            reason,
            detail: rejection_detail(reason, None),
        });
    }
    match purpose {
        Purpose::AdvisePart => validate_advise_part(&value, facts),
        _ => {
            if let Some(diag) = value.get("diagnosis").and_then(|d| d.as_str()) {
                check_diagnosis_sourced(diag, facts)?;
            }
            Ok(Validated::Other(value))
        }
    }
}

fn validate_advise_part(value: &Value, facts: &Value) -> Result<Validated, Rejection> {
    let obj = value.as_object().ok_or_else(|| Rejection {
        reason: RejectionReason::NotJson,
        detail: rejection_detail(RejectionReason::NotJson, None),
    })?;
    let diagnosis = required_string(obj, "diagnosis")?;
    let next_step = required_string(obj, "next_step")?;
    let entry_point = required_string(obj, "entry_point")?;
    let shared_risk = required_string(obj, "shared_risk")?;
    let done_criteria = required_criteria(obj)?;
    check_diagnosis_sourced(&diagnosis, facts)?;
    Ok(Validated::AdvisePart(FrameworkAdvice {
        diagnosis,
        next_step,
        entry_point,
        shared_risk,
        done_criteria,
    }))
}

fn required_string(
    obj: &serde_json::Map<String, Value>,
    field: &str,
) -> Result<String, Rejection> {
    let s = obj
        .get(field)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| Rejection {
            reason: RejectionReason::MissingField,
            detail: rejection_detail(RejectionReason::MissingField, Some(field)),
        })?;
    Ok(s.to_string())
}

fn required_criteria(obj: &serde_json::Map<String, Value>) -> Result<Vec<String>, Rejection> {
    let arr = obj.get("done_criteria").and_then(|v| v.as_array()).ok_or_else(|| {
        Rejection {
            reason: RejectionReason::MissingField,
            detail: rejection_detail(RejectionReason::MissingField, Some("done_criteria")),
        }
    })?;
    let items: Vec<String> = arr
        .iter()
        .filter_map(|v| v.as_str().map(str::trim).filter(|s| !s.is_empty()))
        .map(str::to_string)
        .collect();
    if items.len() < 3 || items.len() > 5 {
        return Err(Rejection {
            reason: RejectionReason::MissingField,
            detail: format!(
                "done_criteria must have 3–5 items, got {}",
                items.len()
            ),
        });
    }
    Ok(items)
}

fn check_diagnosis_sourced(diagnosis: &str, facts: &Value) -> Result<(), Rejection> {
    if diagnosis.contains("事实不足") {
        return Ok(());
    }
    let citations = extract_citations(diagnosis);
    if citations.is_empty() {
        return Err(Rejection {
            reason: RejectionReason::UnsourcedClaim,
            detail: rejection_detail(RejectionReason::UnsourcedClaim, None),
        });
    }
    let facts_text = facts.to_string();
    if citations.iter().any(|c| facts_text.contains(c)) {
        Ok(())
    } else {
        Err(Rejection {
            reason: RejectionReason::UnsourcedClaim,
            detail: rejection_detail(RejectionReason::UnsourcedClaim, None),
        })
    }
}

fn rejection_detail(reason: RejectionReason, field: Option<&str>) -> String {
    match (reason, field) {
        (RejectionReason::ContainsCode, _) => "model output contains code".into(),
        (RejectionReason::ContainsProgressNumber, _) => {
            "model output contains a progress number".into()
        }
        (RejectionReason::MissingField, Some(f)) => format!("missing field: {f}"),
        (RejectionReason::MissingField, None) => "missing field".into(),
        (RejectionReason::UnsourcedClaim, _) => "diagnosis cites no fact".into(),
        (RejectionReason::NotJson, _) => "model output is not JSON".into(),
    }
}

fn forbidden_in_text(text: &str) -> Option<RejectionReason> {
    if text.contains("```") || text.contains("~~~") {
        return Some(RejectionReason::ContainsCode);
    }
    if HUNK_RE.is_match(text) {
        return Some(RejectionReason::ContainsCode);
    }
    if PERCENT_RE.is_match(text) || PROGRESS_RE.is_match(text) {
        return Some(RejectionReason::ContainsProgressNumber);
    }
    for line in text.lines() {
        if line_is_function(line) {
            return Some(RejectionReason::ContainsCode);
        }
    }
    None
}

fn forbidden_in_json(value: &Value) -> Option<RejectionReason> {
    if json_has_progress_key(value) {
        return Some(RejectionReason::ContainsProgressNumber);
    }
    let mut hit = None;
    walk_strings(value, &mut |s| {
        if hit.is_some() {
            return;
        }
        hit = forbidden_in_text(s);
    });
    hit
}

fn json_has_progress_key(value: &Value) -> bool {
    match value {
        Value::Object(o) => {
            for (k, v) in o {
                let kl = k.to_lowercase();
                if (kl == "progress" || k == "进度" || k == "完成度")
                    && (v.is_number() || v.as_str().is_some())
                {
                    return true;
                }
                if json_has_progress_key(v) {
                    return true;
                }
            }
            false
        }
        Value::Array(a) => a.iter().any(json_has_progress_key),
        _ => false,
    }
}

fn walk_strings(value: &Value, f: &mut impl FnMut(&str)) {
    match value {
        Value::String(s) => f(s),
        Value::Array(a) => {
            for v in a {
                walk_strings(v, f);
            }
        }
        Value::Object(o) => {
            for v in o.values() {
                walk_strings(v, f);
            }
        }
        _ => {}
    }
}

fn line_is_function(line: &str) -> bool {
    FN_RS.is_match(line) || FN_JS.is_match(line) || FN_ARROW.is_match(line) || FN_PY.is_match(line)
}

fn extract_citations(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for cap in ISO_DATE.find_iter(text) {
        push_unique(&mut out, cap.as_str());
    }
    for cap in COMMITISH.find_iter(text) {
        let s = cap.as_str();
        if s.chars().any(|c| c.is_ascii_digit()) {
            push_unique(&mut out, s);
        }
    }
    for cap in FILE_PATH.find_iter(text) {
        push_unique(&mut out, cap.as_str());
    }
    for cap in FILENAME.find_iter(text) {
        push_unique(&mut out, cap.as_str());
    }
    for cap in TEST_NAME.find_iter(text) {
        push_unique(&mut out, cap.as_str());
    }
    out
}

fn push_unique(out: &mut Vec<String>, s: &str) {
    if !out.iter().any(|e| e == s) {
        out.push(s.to_string());
    }
}

static HUNK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"@@\s*-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s*@@").expect("hunk"));
static PERCENT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d+(?:\.\d+)?\s*[%％]").expect("percent"));
static PROGRESS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)(进度|完成度|progress)\s*[:=：]?\s*\d|(?i)\d+(?:\.\d+)?\s*[:=：]?\s*(进度|完成度|progress)|\d+\s*/\s*\d+\s*完成",
    )
    .expect("progress")
});
static FN_RS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?fn\s+\w+").expect("fn rs")
});
static FN_JS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+\w+").expect("fn js")
});
static FN_ARROW: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>")
        .expect("fn arrow")
});
static FN_PY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*def\s+\w+\s*\(").expect("fn py"));
static ISO_DATE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2})?").expect("iso"));
static COMMITISH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b[0-9a-f]{7,40}\b").expect("commit"));
static FILE_PATH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b(?:[A-Za-z0-9_.-]+/)+\.?[A-Za-z0-9_.-]+\b").expect("path"));
static FILENAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b[A-Za-z0-9_.-]+\.[A-Za-z][A-Za-z0-9]{0,7}\b").expect("file"));
static TEST_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b(?:c\d+_[A-Za-z0-9_]+|test_[A-Za-z0-9_]+)\b").expect("test"));

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::Cell;

    struct Stub(Result<String, TransportError>);

    impl Transport for Stub {
        fn complete(&self, _req: &ChatRequest) -> Result<String, TransportError> {
            self.0.clone()
        }
    }

    struct IncClock {
        n: Cell<i64>,
    }

    impl Clock for IncClock {
        fn now_rfc3339(&self) -> String {
            let i = self.n.get();
            self.n.set(i + 1);
            format!("2026-09-09T00:00:{i:02}Z")
        }
    }

    fn facts() -> Value {
        json!({
            "files": ["src/db.rs", "app/src-tauri/src/llm.rs"],
            "tests": ["c4_gate_accepts_a_clean_five_field_advice"]
        })
    }

    fn clean_obj() -> Value {
        json!({
            "diagnosis": "left_leg is the short leg because src/db.rs has no passing CI listed in facts.",
            "next_step": "Add the validation gate before any provider call.",
            "entry_point": "app/src-tauri/src/llm.rs",
            "shared_risk": "db.rs schema; llm_call rows must not share the wire table.",
            "done_criteria": [
                "Unknown purpose never reaches the transport",
                "Rejected output is logged with a reason",
                "No-key returns unavailable"
            ]
        })
    }

    fn clean_raw() -> String {
        serde_json::to_string(&clean_obj()).unwrap()
    }

    fn profile() -> ProviderConfig {
        ProviderConfig {
            id: "p1".into(),
            kind: ProviderKind::OpenaiCompatible,
            base_url: "http://127.0.0.1:9/v1".into(),
            model: "test-model".into(),
            key_ref: Some("tinman-test".into()),
        }
    }

    fn deps<'a>(
        profiles: &'a [ProviderConfig],
        keys: &'a dyn KeyStore,
        clock: &'a dyn Clock,
        profile_id: Option<&'a str>,
    ) -> CallDeps<'a> {
        CallDeps {
            workspace_id: "ws-test",
            profile_id,
            profiles,
            keys,
            clock,
        }
    }

    #[test]
    fn c1_purpose_set_is_closed() {
        for p in [
            "map_architecture",
            "advise_part",
            "draft_goal",
            "verify_delivery",
        ] {
            let parsed: Purpose = serde_json::from_value(json!(p)).unwrap();
            assert_eq!(serde_json::to_value(parsed).unwrap(), json!(p));
        }
        assert!(serde_json::from_value::<Purpose>(json!("summarise")).is_err());

        let constructed = Cell::new(false);
        let keys = MemoryKeys::default();
        let clock = IncClock { n: Cell::new(0) };
        let profiles = [profile()];
        let d = deps(&profiles, &keys, &clock, Some("p1"));
        let out = call("summarise", &json!({}), &d, || {
            constructed.set(true);
            Ok(Stub(Ok("nope".into())))
        });
        assert!(out.result.is_err());
        assert!(out.log.is_none());
        assert!(
            !constructed.get(),
            "unknown purpose must not construct an HTTP client"
        );
    }

    #[test]
    fn c2_key_never_appears_in_log_row_or_error() {
        const SENTINEL: &str = "sk-SECRET-SENTINEL-KEY-do-not-log";
        let keys = MemoryKeys::default();
        keys.insert("tinman-test", SENTINEL);
        let clock = IncClock { n: Cell::new(0) };
        let profiles = [profile()];
        let d = deps(&profiles, &keys, &clock, Some("p1"));
        let saw = Cell::new(false);
        struct Capture<'a> {
            expected: &'a str,
            saw: &'a Cell<bool>,
        }
        impl Transport for Capture<'_> {
            fn complete(&self, req: &ChatRequest) -> Result<String, TransportError> {
                self.saw
                    .set(req.authorization.as_deref() == Some(self.expected));
                Err(TransportError::Http(format!(
                    "POST {} failed with 500",
                    req.base_url
                )))
            }
        }
        let out = call("advise_part", &facts(), &d, || {
            Ok(Capture {
                expected: SENTINEL,
                saw: &saw,
            })
        });
        assert!(saw.get(), "openai_compatible call must send the key");
        let result = out.result.expect("typed result, not an invalid purpose");
        let result_s = serde_json::to_string(&result).unwrap();
        assert!(
            !result_s.contains(SENTINEL),
            "key leaked into result: {result_s}"
        );
        match &result {
            LlmCallResult::Unavailable { reason, detail, .. } => {
                assert_eq!(*reason, UnavailableReason::Offline);
                if let Some(d) = detail {
                    assert!(!d.contains(SENTINEL), "key leaked into detail: {d}");
                }
            }
            other => panic!("expected unavailable, got {other:?}"),
        }
        let log = out.log.expect("unavailable call is still logged");
        let log_s = serde_json::to_string(&log).unwrap();
        assert!(!log_s.contains(SENTINEL), "key leaked into log row: {log_s}");
        assert!(!log.request_json.contains(SENTINEL));
        if let Some(r) = &log.response_text {
            assert!(!r.contains(SENTINEL));
        }
    }

    #[test]
    fn c3_call_log_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::open(&dir.path().join("tinman.db")).unwrap();
        let ws = crate::db::create_workspace(&conn, "Demo", "/tmp/demo").unwrap();
        let keys = MemoryKeys::default();
        keys.insert("tinman-test", "c3-test-secret-value");
        let clock = IncClock { n: Cell::new(0) };
        let profiles = [profile()];
        let d = CallDeps {
            workspace_id: &ws.id,
            profile_id: Some("p1"),
            profiles: &profiles,
            keys: &keys,
            clock: &clock,
        };

        let ok = call("advise_part", &facts(), &d, || Ok(Stub(Ok(clean_raw()))));
        let ok_log = ok.log.expect("success is logged");
        crate::db::insert_llm_call(&conn, &ok_log).unwrap();
        match ok.result.unwrap() {
            LlmCallResult::Available { .. } => {}
            other => panic!("expected available, got {other:?}"),
        }

        let mut bad = clean_obj();
        bad["diagnosis"] = json!("short leg; here is code:\n```rust\nfn x() {}\n```");
        let rejected = call("advise_part", &facts(), &d, || {
            Ok(Stub(Ok(serde_json::to_string(&bad).unwrap())))
        });
        let rejected_log = rejected.log.expect("rejection is logged");
        crate::db::insert_llm_call(&conn, &rejected_log).unwrap();
        match rejected.result.unwrap() {
            LlmCallResult::Unavailable {
                reason,
                reject_reason,
                ..
            } => {
                assert_eq!(reason, UnavailableReason::Rejected);
                assert_eq!(reject_reason, Some(RejectionReason::ContainsCode));
            }
            other => panic!("expected rejected, got {other:?}"),
        }

        let listed = crate::db::list_llm_calls(&conn, &ws.id).unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].verdict, "rejected");
        assert_eq!(listed[0].reject_reason.as_deref(), Some("contains_code"));
        assert_eq!(listed[1].verdict, "accepted");
        assert!(listed[1].reject_reason.is_none());
        assert!(listed[0].created_at > listed[1].created_at);
    }

    #[test]
    fn c4_gate_rejects_fenced_code() {
        let mut v = clean_obj();
        v["entry_point"] = json!("see below\n```rust\nfn boom() {}\n```");
        let raw = serde_json::to_string(&v).unwrap();
        let err = validate(Purpose::AdvisePart, &raw, &facts()).unwrap_err();
        assert_eq!(err.reason, RejectionReason::ContainsCode);
    }

    #[test]
    fn c4_gate_rejects_diff_hunk() {
        let mut v = clean_obj();
        v["next_step"] = json!("apply this @@ -1,3 +1,4 @@ hunk");
        let raw = serde_json::to_string(&v).unwrap();
        let err = validate(Purpose::AdvisePart, &raw, &facts()).unwrap_err();
        assert_eq!(err.reason, RejectionReason::ContainsCode);
    }

    #[test]
    fn c4_gate_rejects_percentage() {
        let mut v = clean_obj();
        v["diagnosis"] = json!("src/db.rs is 42% done");
        let raw = serde_json::to_string(&v).unwrap();
        let err = validate(Purpose::AdvisePart, &raw, &facts()).unwrap_err();
        assert_eq!(err.reason, RejectionReason::ContainsProgressNumber);

        v["diagnosis"] = json!("src/db.rs is 42 % complete");
        let raw = serde_json::to_string(&v).unwrap();
        let err = validate(Purpose::AdvisePart, &raw, &facts()).unwrap_err();
        assert_eq!(err.reason, RejectionReason::ContainsProgressNumber);
    }

    #[test]
    fn c4_gate_rejects_progress_fraction() {
        let mut v = clean_obj();
        v["shared_risk"] = json!("3/5 完成 on src/db.rs");
        let raw = serde_json::to_string(&v).unwrap();
        let err = validate(Purpose::AdvisePart, &raw, &facts()).unwrap_err();
        assert_eq!(err.reason, RejectionReason::ContainsProgressNumber);

        v["shared_risk"] = json!("进度 0.4 remaining in src/db.rs");
        let raw = serde_json::to_string(&v).unwrap();
        let err = validate(Purpose::AdvisePart, &raw, &facts()).unwrap_err();
        assert_eq!(err.reason, RejectionReason::ContainsProgressNumber);
    }

    #[test]
    fn c4_gate_rejects_missing_field() {
        for field in [
            "diagnosis",
            "next_step",
            "entry_point",
            "shared_risk",
            "done_criteria",
        ] {
            let mut v = clean_obj();
            v.as_object_mut().unwrap().remove(field);
            let raw = serde_json::to_string(&v).unwrap();
            let err = validate(Purpose::AdvisePart, &raw, &facts()).unwrap_err();
            assert_eq!(err.reason, RejectionReason::MissingField, "{field}");
        }
        let mut v = clean_obj();
        v["diagnosis"] = json!("   ");
        let raw = serde_json::to_string(&v).unwrap();
        let err = validate(Purpose::AdvisePart, &raw, &facts()).unwrap_err();
        assert_eq!(err.reason, RejectionReason::MissingField);
    }

    #[test]
    fn c4_gate_rejects_done_criteria_out_of_range() {
        let mut v = clean_obj();
        v["done_criteria"] = json!(["a", "b"]);
        let raw = serde_json::to_string(&v).unwrap();
        let err = validate(Purpose::AdvisePart, &raw, &facts()).unwrap_err();
        assert_eq!(err.reason, RejectionReason::MissingField);

        v["done_criteria"] = json!(["a", "b", "c", "d", "e", "f"]);
        let raw = serde_json::to_string(&v).unwrap();
        let err = validate(Purpose::AdvisePart, &raw, &facts()).unwrap_err();
        assert_eq!(err.reason, RejectionReason::MissingField);
    }

    #[test]
    fn c4_gate_rejects_unsourced_diagnosis() {
        let mut v = clean_obj();
        v["diagnosis"] = json!("this slot is the bottleneck and should move first");
        let raw = serde_json::to_string(&v).unwrap();
        let err = validate(Purpose::AdvisePart, &raw, &facts()).unwrap_err();
        assert_eq!(err.reason, RejectionReason::UnsourcedClaim);
    }

    #[test]
    fn c4_gate_accepts_shi_shi_bu_zu_without_citation() {
        let mut v = clean_obj();
        v["diagnosis"] = json!("事实不足：需要扫描 tests/");
        let raw = serde_json::to_string(&v).unwrap();
        let got = validate(Purpose::AdvisePart, &raw, &json!({})).unwrap();
        match got {
            Validated::AdvisePart(a) => assert!(a.diagnosis.contains("事实不足")),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn c4_gate_accepts_a_clean_five_field_advice() {
        let got = validate(Purpose::AdvisePart, &clean_raw(), &facts()).unwrap();
        match got {
            Validated::AdvisePart(a) => {
                assert!(a.diagnosis.contains("src/db.rs"));
                assert_eq!(a.done_criteria.len(), 3);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn c5_no_key_is_typed_unavailable_not_error() {
        let constructed = Cell::new(false);
        let keys = MemoryKeys::default();
        let clock = IncClock { n: Cell::new(0) };
        let profiles = [profile()];
        let d = deps(&profiles, &keys, &clock, Some("p1"));
        let out = call("advise_part", &facts(), &d, || {
            constructed.set(true);
            Ok(Stub(Ok(clean_raw())))
        });
        assert!(
            !constructed.get(),
            "no key must not construct an HTTP client"
        );
        let result = out.result.expect("typed unavailable, not a purpose error");
        match result {
            LlmCallResult::Unavailable { reason, .. } => {
                assert_eq!(reason, UnavailableReason::NoKey);
            }
            other => panic!("expected no_key, got {other:?}"),
        }
        let log = out.log.expect("no_key is still logged");
        assert_eq!(log.verdict, "unavailable");
        assert_eq!(log.reject_reason.as_deref(), Some("no_key"));
    }

    #[test]
    fn other_purposes_exist_and_skip_five_field_shape() {
        let raw = json!({"parts": [{"slot": "torso", "label": "core"}]}).to_string();
        let got = validate(Purpose::MapArchitecture, &raw, &facts()).unwrap();
        match got {
            Validated::Other(v) => assert!(v.get("parts").is_some()),
            other => panic!("{other:?}"),
        }
        let _ = validate(Purpose::DraftGoal, &raw, &facts()).unwrap();
        let _ = validate(Purpose::VerifyDelivery, &raw, &facts()).unwrap();
    }
}
