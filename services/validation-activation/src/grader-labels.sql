-- People's labels of the grader validation dataset (packages/grading-validity,
-- "How to label"): one label per person per response in a dataset version,
-- written once and never changed, so a disagreement is never settled by an edit.
CREATE TABLE IF NOT EXISTS curriculum_engine.grader_labels (
  dataset_version text NOT NULL,
  response_id text NOT NULL,
  labeller text NOT NULL,
  acceptable boolean NOT NULL,
  score smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  safety_violation boolean NOT NULL,
  labelled_at timestamptz NOT NULL,
  PRIMARY KEY (dataset_version, response_id, labeller)
);
-- labels.js compares labellers without case, so the store does too.
CREATE UNIQUE INDEX IF NOT EXISTS grader_labels_one_per_person ON curriculum_engine.grader_labels (dataset_version, response_id, lower(labeller));

CREATE OR REPLACE FUNCTION curriculum_engine.forbid_grader_label_change() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable grader label'; END $$;
DROP TRIGGER IF EXISTS grader_labels_immutable ON curriculum_engine.grader_labels;
CREATE TRIGGER grader_labels_immutable BEFORE UPDATE OR DELETE ON curriculum_engine.grader_labels
FOR EACH ROW EXECUTE FUNCTION curriculum_engine.forbid_grader_label_change();
