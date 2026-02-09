resource "google_project_service" "run_api" {
  project            = var.project_id
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "secretmanager_api" {
  project            = var.project_id
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "artifactregistry_api" {
  project            = var.project_id
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "storage_api" {
  project            = var.project_id
  service            = "storage.googleapis.com"
  disable_on_destroy = false
}

resource "google_storage_bucket" "trace_bundles" {
  name                        = var.trace_bucket_name
  location                    = upper(var.region)
  uniform_bucket_level_access = true

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.storage_api]
}

resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = var.artifact_registry_repository
  format        = "DOCKER"

  depends_on = [google_project_service.artifactregistry_api]
}

resource "google_service_account" "ingest" {
  account_id   = var.service_account_name
  display_name = "Happy Paths ingest"
}

resource "google_storage_bucket_iam_member" "trace_bucket_writer" {
  bucket = google_storage_bucket.trace_bundles.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.ingest.email}"
}

resource "google_secret_manager_secret" "team_token" {
  secret_id = var.team_token_secret_name

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager_api]
}

resource "google_secret_manager_secret_iam_member" "team_token_accessor" {
  secret_id = google_secret_manager_secret.team_token.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ingest.email}"
}

resource "google_cloud_run_v2_service" "ingest" {
  name     = var.service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.ingest.email
    timeout         = "300s"

    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }

    containers {
      image = var.image

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      env {
        name  = "HAPPY_PATHS_TEAM_ID"
        value = var.team_id
      }

      env {
        name  = "HAPPY_PATHS_INGEST_GCS_BUCKET"
        value = google_storage_bucket.trace_bundles.name
      }

      env {
        name  = "HAPPY_PATHS_INGEST_GCS_PREFIX"
        value = var.gcs_prefix
      }

      env {
        name  = "HAPPY_PATHS_MAX_BODY_BYTES"
        value = tostring(var.max_body_bytes)
      }

      env {
        name = "HAPPY_PATHS_TEAM_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.team_token.secret_id
            version = "latest"
          }
        }
      }
    }
  }

  traffic {
    percent = 100
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
  }

  depends_on = [google_project_service.run_api]
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count = var.public_invoker ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.ingest.name

  role   = "roles/run.invoker"
  member = "allUsers"
}
