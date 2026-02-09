terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.38.0"
    }
  }
}

provider "google" {
  project = "happy-paths-staging"
  region  = "us-central1"
}
