module "http_ingest" {
  source = "../../modules/http_ingest"

  project_id = "happy-paths-staging"
  region     = "us-central1"

  service_name = "happy-paths-ingest"
  image        = var.ingest_image

  service_account_name         = "happy-paths-ingest"
  trace_bucket_name            = "happy-paths-staging-trace-bundles"
  artifact_registry_repository = "happy-paths"

  team_id                = "continua"
  team_token_secret_name = "happy-paths-team-token"

  gcs_prefix     = ""
  max_body_bytes = 52428800
  public_invoker = true
}

output "service_uri" {
  value = module.http_ingest.service_uri
}
