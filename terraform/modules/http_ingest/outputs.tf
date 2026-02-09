output "service_uri" {
  description = "Cloud Run service URI."
  value       = google_cloud_run_v2_service.ingest.uri
}

output "service_account_email" {
  description = "Runtime service account email."
  value       = google_service_account.ingest.email
}

output "trace_bucket" {
  description = "Trace bundle GCS bucket."
  value       = google_storage_bucket.trace_bundles.name
}

output "team_token_secret_name" {
  description = "Secret name storing HAPPY_PATHS_TEAM_TOKEN."
  value       = google_secret_manager_secret.team_token.secret_id
}
