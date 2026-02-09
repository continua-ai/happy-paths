terraform {
  backend "gcs" {
    bucket = "happy-paths-staging-terraform"
    prefix = "happy-paths/ingest/staging"
  }
}
