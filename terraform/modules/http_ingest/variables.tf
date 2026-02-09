variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "Cloud Run / Artifact Registry region."
  type        = string
  default     = "us-central1"
}

variable "service_name" {
  description = "Cloud Run service name."
  type        = string
}

variable "image" {
  description = "Container image (Artifact Registry URL)."
  type        = string
}

variable "service_account_name" {
  description = "Service account name (not email)."
  type        = string
  default     = "happy-paths-ingest"
}

variable "trace_bucket_name" {
  description = "GCS bucket for raw trace bundles."
  type        = string
}

variable "artifact_registry_repository" {
  description = "Artifact Registry repository name for images."
  type        = string
  default     = "happy-paths"
}

variable "team_id" {
  description = "Team ID for single-tenant mode."
  type        = string
  default     = "default"
}

variable "team_token_secret_name" {
  description = "Secret Manager secret name storing HAPPY_PATHS_TEAM_TOKEN."
  type        = string
  default     = "happy-paths-team-token"
}

variable "gcs_prefix" {
  description = "Optional key prefix within the trace bucket."
  type        = string
  default     = ""
}

variable "max_body_bytes" {
  description = "Maximum request body size for uploads."
  type        = number
  default     = 52428800
}

variable "public_invoker" {
  description = "If true, allow unauthenticated invocation (auth is via bearer token)."
  type        = bool
  default     = true
}
