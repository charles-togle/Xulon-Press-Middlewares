-- ============================================================================
-- NK KEY GENERATION HELPERS
-- ============================================================================

-- Helper for dim_person
CREATE OR REPLACE FUNCTION generate_person_nk_key(
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone_number text DEFAULT NULL
)
RETURNS text AS $$
BEGIN
  RETURN 
    to_text_nn(p_first_name)   || E'\x1F' ||
    to_text_nn(p_last_name)    || E'\x1F' ||
    to_text_nn(p_email)        || E'\x1F' ||
    to_text_nn(p_phone_number);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Helper for dim_address
CREATE OR REPLACE FUNCTION generate_address_nk_key(
  p_full_address text DEFAULT NULL,
  p_address_line1 text DEFAULT NULL,
  p_address_line2 text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_state_region text DEFAULT NULL,
  p_postal_code text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_time_zone text DEFAULT NULL
)
RETURNS text AS $$
BEGIN
  RETURN 
    to_text_nn(p_full_address)  || E'\x1F' ||
    to_text_nn(p_address_line1) || E'\x1F' ||
    to_text_nn(p_address_line2) || E'\x1F' ||
    to_text_nn(p_city)          || E'\x1F' ||
    to_text_nn(p_state_region)  || E'\x1F' ||
    to_text_nn(p_postal_code)   || E'\x1F' ||
    to_text_nn(p_country)       || E'\x1F' ||
    to_text_nn(p_time_zone);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Helper for dim_acquisition
CREATE OR REPLACE FUNCTION generate_acquisition_nk_key(
  p_source text DEFAULT NULL,
  p_website_landing_page text DEFAULT NULL,
  p_lead_source text DEFAULT NULL,
  p_data_source text DEFAULT NULL
)
RETURNS text AS $$
BEGIN
  RETURN 
    to_text_nn(p_source)               || E'\x1F' ||
    to_text_nn(p_website_landing_page) || E'\x1F' ||
    to_text_nn(p_lead_source)          || E'\x1F' ||
    to_text_nn(p_data_source);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Helper for dim_metadata
CREATE OR REPLACE FUNCTION generate_metadata_nk_key(
  p_opt_out_of_emails boolean DEFAULT false,
  p_outreach_attempt int DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS text AS $$
BEGIN
  RETURN 
    CASE WHEN p_opt_out_of_emails THEN '1' ELSE '0' END || E'\x1F' ||
    to_text_nn(p_outreach_attempt)                       || E'\x1F' ||
    md5(to_text_nn(p_notes));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Helper for dim_opportunity (FIXED with correct delimiter)
CREATE OR REPLACE FUNCTION generate_opportunity_nk_key(
  p_lead_owner text DEFAULT NULL,
  p_lead_value text DEFAULT '0',
  p_is_author boolean DEFAULT false,
  p_current_author boolean DEFAULT false,
  p_publisher text DEFAULT NULL,
  p_genre text DEFAULT NULL,
  p_book_description text DEFAULT NULL,
  p_writing_status text DEFAULT NULL,
  p_rating text DEFAULT NULL,
  p_pipeline_stage text DEFAULT NULL,
  p_stage_id text DEFAULT NULL,
  p_pipeline_id text DEFAULT NULL
)
RETURNS text AS $$
BEGIN
  RETURN 
    to_text_nn(p_lead_owner)          || E'\x1F' ||
    to_text_nn(p_lead_value)          || E'\x1F' ||
    to_text_nn((p_is_author)::int)    || E'\x1F' ||
    to_text_nn((p_current_author)::int) || E'\x1F' ||
    to_text_nn(p_publisher)           || E'\x1F' ||
    to_text_nn(p_genre)               || E'\x1F' ||
    md5(to_text_nn(p_book_description)) || E'\x1F' ||
    to_text_nn(p_writing_status)      || E'\x1F' ||
    to_text_nn(p_rating)              || E'\x1F' ||
    to_text_nn(p_pipeline_stage)      || E'\x1F' ||
    to_text_nn(p_stage_id)            || E'\x1F' ||
    to_text_nn(p_pipeline_id);
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ============================================================================
-- CONCURRENCY-SAFE UPDATE OR REPOINT FUNCTIONS
-- ============================================================================

-- PERSON
CREATE OR REPLACE FUNCTION update_or_repoint_person_by_ghl(
  p_fact_id uuid,
  p_current_id int,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone_number text
)
RETURNS TABLE(new_id int, changed boolean)
LANGUAGE plpgsql AS $$
DECLARE
  v_refcount bigint;
  v_first_name text; v_last_name text; v_email text; v_phone_number text;
  v_nk text; v_current_nk text;
BEGIN
  IF p_first_name IS NULL AND p_last_name IS NULL AND p_email IS NULL AND p_phone_number IS NULL THEN
    RETURN QUERY SELECT p_current_id, false; RETURN;
  END IF;

  SELECT COALESCE(p_first_name, first_name),
         COALESCE(p_last_name, last_name),
         COALESCE(normalize_email(p_email), email),
         COALESCE(normalize_phone_us_only(p_phone_number), phone_number),
         nk_key
    INTO v_first_name, v_last_name, v_email, v_phone_number, v_current_nk
  FROM dim_person WHERE person_dim_id = p_current_id;

  v_nk := generate_person_nk_key(v_first_name, v_last_name, v_email, v_phone_number);
  PERFORM pg_advisory_xact_lock(hashtext(v_nk));
  IF v_nk = v_current_nk THEN
    SELECT count(*) INTO v_refcount FROM fact_contacts WHERE person_dim_id = p_current_id;
    IF v_refcount = 1 THEN
      UPDATE dim_person
         SET first_name = v_first_name,
             last_name = v_last_name,
             email = v_email,
             phone_number = v_phone_number
       WHERE person_dim_id = p_current_id;
      RETURN QUERY SELECT p_current_id, true; RETURN;
    END IF;
    RETURN QUERY SELECT p_current_id, false; RETURN;
  END IF;

  WITH ins AS (
    INSERT INTO dim_person(first_name, last_name, email, phone_number)
    VALUES (v_first_name, v_last_name, v_email, v_phone_number)
    ON CONFLICT ON (nk_key) DO NOTHING
    RETURNING person_dim_id
  ),
  target AS (
    SELECT person_dim_id FROM ins
    UNION ALL
    SELECT person_dim_id FROM dim_person WHERE nk_key = v_nk
    LIMIT 1
  ),
  repoint AS (
    UPDATE fact_contacts f
       SET person_dim_id = t.person_dim_id
      FROM target t
     WHERE f.fact_id = p_fact_id
    RETURNING t.person_dim_id AS new_id
  )
  SELECT r.new_id, (r.new_id <> p_current_id) AS changed
    INTO new_id, changed
  FROM repoint r;

  RETURN;
END;
$$;


-- ADDRESS
CREATE OR REPLACE FUNCTION update_or_repoint_address_by_ghl(
  p_fact_id uuid,
  p_current_id int,
  p_full_address text,
  p_address_line1 text,
  p_address_line2 text,
  p_city text,
  p_state_region text,
  p_postal_code text,
  p_country text,
  p_time_zone text
)
RETURNS TABLE(new_id int, changed boolean)
LANGUAGE plpgsql AS $$
DECLARE
  v_refcount bigint;
  v_full_address text; v_address_line1 text; v_address_line2 text; v_city text;
  v_state_region text; v_postal_code text; v_country text; v_time_zone text;
  v_nk text; v_current_nk text;
BEGIN
  IF p_full_address IS NULL AND p_address_line1 IS NULL AND p_address_line2 IS NULL
     AND p_city IS NULL AND p_state_region IS NULL AND p_postal_code IS NULL
     AND p_country IS NULL AND p_time_zone IS NULL THEN
    RETURN QUERY SELECT p_current_id, false; RETURN;
  END IF;

  SELECT COALESCE(p_full_address, full_address),
         COALESCE(p_address_line1, address_line1),
         COALESCE(p_address_line2, address_line2),
         COALESCE(p_city, city),
         COALESCE(p_state_region, state_region),
         COALESCE(p_postal_code, postal_code),
         COALESCE(p_country, country),
         COALESCE(p_time_zone, time_zone),
         nk_key
    INTO v_full_address, v_address_line1, v_address_line2, v_city,
         v_state_region, v_postal_code, v_country, v_time_zone, v_current_nk
  FROM dim_address WHERE address_dim_id = p_current_id;

  v_nk := generate_address_nk_key(
    v_full_address, v_address_line1, v_address_line2, v_city,
    v_state_region, v_postal_code, v_country, v_time_zone
  );
  PERFORM pg_advisory_xact_lock(hashtext(v_nk));
  IF v_nk = v_current_nk THEN
    SELECT count(*) INTO v_refcount FROM fact_contacts WHERE address_dim_id = p_current_id;
    IF v_refcount = 1 THEN
      UPDATE dim_address
         SET full_address = v_full_address,
             address_line1 = v_address_line1,
             address_line2 = v_address_line2,
             city = v_city,
             state_region = v_state_region,
             postal_code = v_postal_code,
             country = v_country,
             time_zone = v_time_zone
       WHERE address_dim_id = p_current_id;
      RETURN QUERY SELECT p_current_id, true; RETURN;
    END IF;
    RETURN QUERY SELECT p_current_id, false; RETURN;
  END IF;

  WITH ins AS (
    INSERT INTO dim_address(
      full_address, address_line1, address_line2, city,
      state_region, postal_code, country, time_zone
    )
    VALUES (
      v_full_address, v_address_line1, v_address_line2, v_city,
      v_state_region, v_postal_code, v_country, v_time_zone
    )
    ON CONFLICT ON (nk_key) DO NOTHING
    RETURNING address_dim_id
  ),
  target AS (
    SELECT address_dim_id FROM ins
    UNION ALL
    SELECT address_dim_id FROM dim_address WHERE nk_key = v_nk
    LIMIT 1
  ),
  repoint AS (
    UPDATE fact_contacts f
       SET address_dim_id = t.address_dim_id
      FROM target t
     WHERE f.fact_id = p_fact_id
    RETURNING t.address_dim_id AS new_id
  )
  SELECT r.new_id, (r.new_id <> p_current_id) AS changed
    INTO new_id, changed
  FROM repoint r;

  RETURN;
END;
$$;


-- ACQUISITION
CREATE OR REPLACE FUNCTION update_or_repoint_acquisition_by_ghl(
  p_fact_id uuid,
  p_current_id int,
  p_source text,
  p_website_landing_page text,
  p_lead_source text,
  p_data_source text
)
RETURNS TABLE(new_id int, changed boolean)
LANGUAGE plpgsql AS $$
DECLARE
  v_refcount bigint;
  v_source text; v_website_landing_page text; v_lead_source text; v_data_source text;
  v_nk text; v_current_nk text;
BEGIN
  IF p_source IS NULL AND p_website_landing_page IS NULL AND p_lead_source IS NULL AND p_data_source IS NULL THEN
    RETURN QUERY SELECT p_current_id, false; RETURN;
  END IF;

  SELECT COALESCE(p_source, source),
         COALESCE(p_website_landing_page, website_landing_page),
         COALESCE(p_lead_source, lead_source),
         COALESCE(p_data_source, data_source),
         nk_key
    INTO v_source, v_website_landing_page, v_lead_source, v_data_source, v_current_nk
  FROM dim_acquisition WHERE acquisition_dim_id = p_current_id;

  v_nk := generate_acquisition_nk_key(v_source, v_website_landing_page, v_lead_source, v_data_source);
  PERFORM pg_advisory_xact_lock(hashtext(v_nk));

  IF v_nk = v_current_nk THEN
    SELECT count(*) INTO v_refcount FROM fact_contacts WHERE acquisition_dim_id = p_current_id;
    IF v_refcount = 1 THEN
      UPDATE dim_acquisition
         SET source = v_source,
             website_landing_page = v_website_landing_page,
             lead_source = v_lead_source,
             data_source = v_data_source
       WHERE acquisition_dim_id = p_current_id;
      RETURN QUERY SELECT p_current_id, true; RETURN;
    END IF;
    RETURN QUERY SELECT p_current_id, false; RETURN;
  END IF;

  WITH ins AS (
    INSERT INTO dim_acquisition(source, website_landing_page, lead_source, data_source)
    VALUES (v_source, v_website_landing_page, v_lead_source, v_data_source)
    ON CONFLICT ON (nk_key) DO NOTHING
    RETURNING acquisition_dim_id
  ),
  target AS (
    SELECT acquisition_dim_id FROM ins
    UNION ALL
    SELECT acquisition_dim_id FROM dim_acquisition WHERE nk_key = v_nk
    LIMIT 1
  ),
  repoint AS (
    UPDATE fact_contacts f
       SET acquisition_dim_id = t.acquisition_dim_id
      FROM target t
     WHERE f.fact_id = p_fact_id
    RETURNING t.acquisition_dim_id AS new_id
  )
  SELECT r.new_id, (r.new_id <> p_current_id) AS changed
    INTO new_id, changed
  FROM repoint r;

  RETURN;
END;
$$;


-- METADATA
CREATE OR REPLACE FUNCTION update_or_repoint_metadata_by_ghl(
  p_fact_id uuid,
  p_current_id int,
  p_opt_out_of_emails boolean,
  p_outreach_attempt int,
  p_notes text
)
RETURNS TABLE(new_id int, changed boolean)
LANGUAGE plpgsql AS $$
DECLARE
  v_refcount bigint;
  v_opt_out_of_emails boolean; v_outreach_attempt int; v_notes text;
  v_nk text; v_current_nk text;
BEGIN
  IF p_opt_out_of_emails IS NULL AND p_outreach_attempt IS NULL AND p_notes IS NULL THEN
    RETURN QUERY SELECT p_current_id, false; RETURN;
  END IF;

  SELECT COALESCE(p_opt_out_of_emails, opt_out_of_emails),
         COALESCE(p_outreach_attempt, outreach_attempt),
         COALESCE(p_notes, notes),
         nk_key
    INTO v_opt_out_of_emails, v_outreach_attempt, v_notes, v_current_nk
  FROM dim_metadata WHERE metadata_dim_id = p_current_id;

  v_nk := generate_metadata_nk_key(v_opt_out_of_emails, v_outreach_attempt, v_notes);
  PERFORM pg_advisory_xact_lock(hashtext(v_nk));
  IF v_nk = v_current_nk THEN
    SELECT count(*) INTO v_refcount FROM fact_contacts WHERE metadata_dim_id = p_current_id;
    IF v_refcount = 1 THEN
      UPDATE dim_metadata
         SET opt_out_of_emails = v_opt_out_of_emails,
             outreach_attempt  = v_outreach_attempt,
             notes             = v_notes
       WHERE metadata_dim_id = p_current_id;
      RETURN QUERY SELECT p_current_id, true; RETURN;
    END IF;
    RETURN QUERY SELECT p_current_id, false; RETURN;
  END IF;

  WITH ins AS (
    INSERT INTO dim_metadata(opt_out_of_emails, outreach_attempt, notes)
    VALUES (v_opt_out_of_emails, v_outreach_attempt, v_notes)
    ON CONFLICT ON (nk_key) DO NOTHING
    RETURNING metadata_dim_id
  ),
  target AS (
    SELECT metadata_dim_id FROM ins
    UNION ALL
    SELECT metadata_dim_id FROM dim_metadata WHERE nk_key = v_nk
    LIMIT 1
  ),
  repoint AS (
    UPDATE fact_contacts f
       SET metadata_dim_id = t.metadata_dim_id
      FROM target t
     WHERE f.fact_id = p_fact_id
    RETURNING t.metadata_dim_id AS new_id
  )
  SELECT r.new_id, (r.new_id <> p_current_id) AS changed
    INTO new_id, changed
  FROM repoint r;

  RETURN;
END;
$$;


-- OPPORTUNITY
CREATE OR REPLACE FUNCTION update_or_repoint_opportunity_by_ghl(
  p_fact_id uuid,
  p_current_id int,
  p_lead_owner text,
  p_lead_value text,
  p_is_author boolean,
  p_current_author boolean,
  p_publisher text,
  p_genre text,
  p_book_description text,
  p_writing_status text,
  p_rating text,
  p_pipeline_stage text,
  p_stage_id text,
  p_pipeline_id text
)
RETURNS TABLE(new_id int, changed boolean)
LANGUAGE plpgsql AS $$
DECLARE
  v_refcount bigint;
  v_lead_owner text; v_lead_value text; v_is_author boolean; v_current_author boolean;
  v_publisher text; v_genre text; v_book_description text; v_writing_status text;
  v_rating text; v_pipeline_stage text; v_stage_id text; v_pipeline_id text;
  v_nk text; v_current_nk text;
BEGIN
  IF p_lead_owner IS NULL AND p_lead_value IS NULL AND p_is_author IS NULL AND p_current_author IS NULL
     AND p_publisher IS NULL AND p_genre IS NULL AND p_book_description IS NULL AND p_writing_status IS NULL
     AND p_rating IS NULL AND p_pipeline_stage IS NULL AND p_stage_id IS NULL AND p_pipeline_id IS NULL THEN
    RETURN QUERY SELECT p_current_id, false; RETURN;
  END IF;

  SELECT COALESCE(p_lead_owner, lead_owner),
         COALESCE(p_lead_value, lead_value),
         COALESCE(p_is_author, is_author),
         COALESCE(p_current_author, current_author),
         COALESCE(p_publisher, publisher),
         COALESCE(p_genre, genre),
         COALESCE(p_book_description, book_description),
         COALESCE(p_writing_status, writing_status),
         COALESCE(p_rating, rating),
         COALESCE(p_pipeline_stage, pipeline_stage),
         COALESCE(p_stage_id, stage_id),
         COALESCE(p_pipeline_id, pipeline_id),
         nk_key
    INTO v_lead_owner, v_lead_value, v_is_author, v_current_author,
         v_publisher, v_genre, v_book_description, v_writing_status,
         v_rating, v_pipeline_stage, v_stage_id, v_pipeline_id, v_current_nk
  FROM dim_opportunity WHERE opportunity_dim_id = p_current_id;

  v_nk := generate_opportunity_nk_key(
    v_lead_owner, v_lead_value, v_is_author, v_current_author,
    v_publisher, v_genre, v_book_description, v_writing_status,
    v_rating, v_pipeline_stage, v_stage_id, v_pipeline_id
  );
  PERFORM pg_advisory_xact_lock(hashtext(v_nk));
  IF v_nk = v_current_nk THEN
    SELECT count(*) INTO v_refcount FROM fact_contacts WHERE opportunity_dim_id = p_current_id;
    IF v_refcount = 1 THEN
      UPDATE dim_opportunity
         SET lead_owner      = v_lead_owner,
             lead_value      = v_lead_value,
             is_author       = v_is_author,
             current_author  = v_current_author,
             publisher       = v_publisher,
             genre           = v_genre,
             book_description= v_book_description,
             writing_status  = v_writing_status,
             rating          = v_rating,
             pipeline_stage  = v_pipeline_stage,
             stage_id        = v_stage_id,
             pipeline_id     = v_pipeline_id
       WHERE opportunity_dim_id = p_current_id;
      RETURN QUERY SELECT p_current_id, true; RETURN;
    END IF;
    RETURN QUERY SELECT p_current_id, false; RETURN;
  END IF;

  WITH ins AS (
    INSERT INTO dim_opportunity(
      lead_owner, lead_value, is_author, current_author, publisher,
      genre, book_description, writing_status, rating,
      pipeline_stage, stage_id, pipeline_id
    )
    VALUES (
      v_lead_owner, v_lead_value, v_is_author, v_current_author, v_publisher,
      v_genre, v_book_description, v_writing_status, v_rating,
      v_pipeline_stage, v_stage_id, v_pipeline_id
    )
    ON CONFLICT ON (nk_key) DO NOTHING
    RETURNING opportunity_dim_id
  ),
  target AS (
    SELECT opportunity_dim_id FROM ins
    UNION ALL
    SELECT opportunity_dim_id FROM dim_opportunity WHERE nk_key = v_nk
    LIMIT 1
  ),
  repoint AS (
    UPDATE fact_contacts f
       SET opportunity_dim_id = t.opportunity_dim_id
      FROM target t
     WHERE f.fact_id = p_fact_id
    RETURNING t.opportunity_dim_id AS new_id
  )
  SELECT r.new_id, (r.new_id <> p_current_id) AS changed
    INTO new_id, changed
  FROM repoint r;

  RETURN;
END;
$$;

-- ============================================================================
-- SINGLE ORCHESTRATOR FUNCTION TO UPDATE CONTACT BY GHL ID
-- ============================================================================

CREATE OR REPLACE FUNCTION update_contact_in_star_schema_by_ghl(
  p_ghl_contact_id text,
  -- person
  p_first_name text default null, 
  p_last_name text default null,
  p_email text default null, 
  p_phone_number text default null,
  -- address
  p_full_address text default null, 
  p_address_line1 text default null, 
  p_address_line2 text default null,
  p_city text default null, 
  p_state_region text default null, 
  p_postal_code text default null,
  p_country text default null, 
  p_time_zone text default null,
  -- acquisition
  p_source text default null,
  p_website_landing_page text default null, 
  p_lead_source text default null,
  p_data_source text default null,
  -- opportunity
  p_lead_owner text default null, 
  p_lead_value text default null, 
  p_is_author boolean default null,
  p_current_author boolean default null, 
  p_publisher text default null, 
  p_genre text default null,
  p_book_description text default null, 
  p_writing_status text default null, 
  p_rating text default null,
  p_pipeline_stage text default null, 
  p_stage_id text default null, 
  p_pipeline_id text default null,
  -- metadata
  p_opt_out_of_emails boolean default null, 
  p_outreach_attempt int default null, 
  p_notes text default null,
  -- optional: allow changing ghl ids
  p_new_ghl_contact_id text default null, 
  p_new_ghl_opportunity_id text default null
) RETURNS TABLE(fact_id uuid, ghl_contact_id text, ghl_opportunity_id text, einstein_url text)
LANGUAGE plpgsql AS $$
DECLARE
  rec record;
  v_changed boolean;
  v_tmp_changed boolean;
  v_new_id int;
BEGIN
  SELECT f.*
    INTO rec
  FROM fact_contacts f
  WHERE f.ghl_contact_id = p_ghl_contact_id
  ORDER BY f.dates_dim_id DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN; -- nothing to update
  END IF;

  v_changed := false;

  SELECT new_id, changed INTO v_new_id, v_tmp_changed
  FROM update_or_repoint_person_by_ghl(rec.fact_id, rec.person_dim_id,
       p_first_name, p_last_name, p_email, p_phone_number);
  v_changed := v_changed OR v_tmp_changed;

  SELECT new_id, changed INTO v_new_id, v_tmp_changed
  FROM update_or_repoint_address_by_ghl(rec.fact_id, rec.address_dim_id,
       p_full_address, p_address_line1, p_address_line2, p_city, p_state_region,
       p_postal_code, p_country, p_time_zone);
  v_changed := v_changed OR v_tmp_changed;

  SELECT new_id, changed INTO v_new_id, v_tmp_changed
  FROM update_or_repoint_acquisition_by_ghl(rec.fact_id, rec.acquisition_dim_id,
       p_source, p_website_landing_page, p_lead_source, p_data_source);
  v_changed := v_changed OR v_tmp_changed;

  SELECT new_id, changed INTO v_new_id, v_tmp_changed
  FROM update_or_repoint_opportunity_by_ghl(rec.fact_id, rec.opportunity_dim_id,
       p_lead_owner, p_lead_value, p_is_author, p_current_author,
       p_publisher, p_genre, p_book_description, p_writing_status,
       p_rating, p_pipeline_stage, p_stage_id, p_pipeline_id);
  v_changed := v_changed OR v_tmp_changed;

  SELECT new_id, changed INTO v_new_id, v_tmp_changed
  FROM update_or_repoint_metadata_by_ghl(rec.fact_id, rec.metadata_dim_id,
       p_opt_out_of_emails, p_outreach_attempt, p_notes);
  v_changed := v_changed OR v_tmp_changed;

  IF p_new_ghl_contact_id IS NOT NULL OR p_new_ghl_opportunity_id IS NOT NULL THEN
    UPDATE public.fact_contacts AS fc
       SET ghl_contact_id     = COALESCE(p_new_ghl_contact_id, fc.ghl_contact_id),
           ghl_opportunity_id = COALESCE(p_new_ghl_opportunity_id, fc.ghl_opportunity_id)
     WHERE fc.fact_id = rec.fact_id;
  END IF;

  IF v_changed THEN
    UPDATE public.fact_contacts AS fc
       SET dates_dim_id = find_or_insert_dates_preserve_create(rec.dates_dim_id)
     WHERE fc.fact_id = rec.fact_id;
  END IF;

  RETURN QUERY
  SELECT fc.fact_id, fc.ghl_contact_id, fc.ghl_opportunity_id, fc.einstein_url
  FROM public.fact_contacts fc
  WHERE fc.fact_id = rec.fact_id;
END;
$$;