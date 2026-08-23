ALTER TABLE import_jobs ADD COLUMN openai_response_id TEXT;
ALTER TABLE import_jobs ADD COLUMN raw_file_name TEXT;
ALTER TABLE import_jobs ADD COLUMN raw_file_type TEXT;
ALTER TABLE import_jobs ADD COLUMN raw_file_size INTEGER;
