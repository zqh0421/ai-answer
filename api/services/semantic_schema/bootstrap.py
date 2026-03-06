from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List

from sqlalchemy import text
from sqlalchemy.orm import Session


ID_LEN = 16
ID_TYPE = f"VARCHAR({ID_LEN})"


@dataclass(frozen=True)
class DDLStep:
    name: str
    sql: str


def _ddl_steps() -> List[DDLStep]:
    # Transitional table names avoid collisions with existing legacy tables.
    # They can be renamed during cutover once legacy tables are archived.
    return [
        DDLStep(
            "users_add_user_id",
            f"""
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS user_id {ID_TYPE};
            """,
        ),
        DDLStep(
            "users_add_user_id_index",
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_users_user_id_not_null
            ON users (user_id)
            WHERE user_id IS NOT NULL;
            """,
        ),
        DDLStep(
            "feedback_agent",
            f"""
            CREATE TABLE IF NOT EXISTS feedback_agent (
                agent_id {ID_TYPE} PRIMARY KEY,
                source_agent_id {ID_TYPE} NULL,
                title VARCHAR(255) NOT NULL,
                description TEXT NULL,
                role VARCHAR(10) NOT NULL,
                is_structured BOOLEAN NOT NULL DEFAULT FALSE,
                provider VARCHAR(50) NULL,
                model VARCHAR(100) NULL,
                prompt_text TEXT NULL,
                apply_question_type VARCHAR(20) NULL DEFAULT 'all',
                if_score BOOLEAN NOT NULL DEFAULT FALSE,
                score_ai_agent_id {ID_TYPE} NULL,
                access_scope VARCHAR(10) NOT NULL DEFAULT 'private',
                is_visible BOOLEAN NOT NULL DEFAULT TRUE,
                created_by {ID_TYPE} NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                CONSTRAINT chk_feedback_agent_role CHECK (role IN ('human', 'ai')),
                CONSTRAINT chk_feedback_agent_apply_question_type CHECK (
                    apply_question_type IS NULL OR apply_question_type IN (
                        'single_choice', 'multi_choice', 'dropdown', 'true_false', 'free_text', 'essay', 'all'
                    )
                ),
                CONSTRAINT chk_feedback_agent_score_mode CHECK (
                    (if_score = FALSE AND score_ai_agent_id IS NULL)
                    OR (if_score = TRUE AND score_ai_agent_id IS NOT NULL)
                ),
                CONSTRAINT chk_feedback_agent_access_scope CHECK (access_scope IN ('private', 'public')),
                CONSTRAINT fk_feedback_agent_score_ai_agent FOREIGN KEY (score_ai_agent_id) REFERENCES feedback_agent(agent_id),
                CONSTRAINT fk_feedback_agent_source FOREIGN KEY (source_agent_id) REFERENCES feedback_agent(agent_id)
            );
            """,
        ),
        DDLStep(
            "feedback_agent_add_apply_question_type_column",
            """
            ALTER TABLE feedback_agent
            ADD COLUMN IF NOT EXISTS apply_question_type VARCHAR(20) NULL DEFAULT 'all';
            """,
        ),
        DDLStep(
            "feedback_agent_apply_question_type_data_normalization",
            """
            UPDATE feedback_agent
            SET apply_question_type = 'all'
            WHERE apply_question_type IN ('one', 'single_selection');

            UPDATE feedback_agent
            SET apply_question_type = 'all'
            WHERE apply_question_type IN ('multiple', 'multiple_selection');
            """,
        ),
        DDLStep(
            "feedback_agent_apply_question_type_constraint",
            """
            DO $$
            BEGIN
                ALTER TABLE feedback_agent
                DROP CONSTRAINT IF EXISTS chk_feedback_agent_apply_question_type;

                ALTER TABLE feedback_agent
                ADD CONSTRAINT chk_feedback_agent_apply_question_type
                CHECK (
                    apply_question_type IS NULL OR apply_question_type IN (
                        'single_choice', 'multi_choice', 'dropdown', 'true_false', 'free_text', 'essay', 'all'
                    )
                );
            END $$;
            """,
        ),
        DDLStep(
            "feedback_agent_add_if_score_columns",
            f"""
            ALTER TABLE feedback_agent
            ADD COLUMN IF NOT EXISTS if_score BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS score_ai_agent_id {ID_TYPE} NULL;
            """,
        ),
        DDLStep(
            "feedback_agent_if_score_data_normalization",
            """
            UPDATE feedback_agent
            SET if_score = TRUE
            WHERE score_ai_agent_id IS NOT NULL;

            UPDATE feedback_agent
            SET if_score = FALSE
            WHERE score_ai_agent_id IS NULL;
            """,
        ),
        DDLStep(
            "feedback_agent_if_score_constraints",
            """
            DO $$
            BEGIN
                ALTER TABLE feedback_agent
                DROP CONSTRAINT IF EXISTS chk_feedback_agent_score_mode;

                ALTER TABLE feedback_agent
                ADD CONSTRAINT chk_feedback_agent_score_mode
                CHECK (
                    (if_score = FALSE AND score_ai_agent_id IS NULL)
                    OR (if_score = TRUE AND score_ai_agent_id IS NOT NULL)
                );

                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'fk_feedback_agent_score_ai_agent'
                ) THEN
                    ALTER TABLE feedback_agent
                    ADD CONSTRAINT fk_feedback_agent_score_ai_agent
                    FOREIGN KEY (score_ai_agent_id) REFERENCES feedback_agent(agent_id);
                END IF;
            END $$;
            """,
        ),
        DDLStep(
            "feedback_agent_drop_execution_mode_column",
            """
            ALTER TABLE feedback_agent
            DROP COLUMN IF EXISTS execution_mode;
            """,
        ),
        DDLStep(
            "feedback_agent_ensure_llm_params_jsonb",
            """
            DO $$
            DECLARE
                col_type TEXT;
            BEGIN
                SELECT c.data_type
                INTO col_type
                FROM information_schema.columns c
                WHERE c.table_name = 'feedback_agent'
                  AND c.column_name = 'llm_params_text'
                LIMIT 1;

                IF col_type IS NULL THEN
                    ALTER TABLE feedback_agent
                    ADD COLUMN llm_params_text JSONB NULL;
                ELSIF col_type <> 'jsonb' THEN
                    ALTER TABLE feedback_agent
                    ALTER COLUMN llm_params_text TYPE JSONB
                    USING (
                        CASE
                            WHEN llm_params_text IS NULL OR btrim(llm_params_text::text) = '' THEN NULL
                            ELSE llm_params_text::jsonb
                        END
                    );
                END IF;
            END $$;
            """,
        ),
        DDLStep(
            "feedback_agent_idx_created_by_visible",
            """
            CREATE INDEX IF NOT EXISTS ix_feedback_agent_created_by_visible
            ON feedback_agent (created_by, is_visible);
            """,
        ),
        DDLStep(
            "feedback_agent_idx_access_scope_visible",
            """
            CREATE INDEX IF NOT EXISTS ix_feedback_agent_access_scope_visible
            ON feedback_agent (access_scope, is_visible);
            """,
        ),
        DDLStep(
            "feedback_agent_idx_role_visible",
            """
            CREATE INDEX IF NOT EXISTS ix_feedback_agent_role_visible
            ON feedback_agent (role, is_visible);
            """,
        ),
        DDLStep(
            "feedback_agent_input",
            f"""
            CREATE TABLE IF NOT EXISTS feedback_agent_input (
                agent_input_id {ID_TYPE} PRIMARY KEY,
                agent_id {ID_TYPE} NOT NULL,
                input_key VARCHAR(50) NOT NULL,
                is_required BOOLEAN NOT NULL DEFAULT TRUE,
                sort_order INT NOT NULL DEFAULT 100,
                created_by {ID_TYPE} NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                CONSTRAINT fk_feedback_agent_input_agent FOREIGN KEY (agent_id) REFERENCES feedback_agent(agent_id) ON DELETE CASCADE,
                CONSTRAINT uq_feedback_agent_input UNIQUE (agent_id, input_key)
            );
            """,
        ),
        DDLStep(
            "feedback_agent_input_indexes",
            """
            CREATE INDEX IF NOT EXISTS ix_feedback_agent_input_agent_sort
            ON feedback_agent_input (agent_id, sort_order);
            """,
        ),
        DDLStep(
            "feedback_agent_input_retrieval_rule",
            f"""
            CREATE TABLE IF NOT EXISTS feedback_agent_input_retrieval_rule (
                agent_input_id {ID_TYPE} PRIMARY KEY,
                preferred_info_type VARCHAR(10) NOT NULL DEFAULT 'text',
                selection_mode VARCHAR(30) NOT NULL,
                max_pages INT NULL,
                similarity_threshold NUMERIC(6,5) NULL,
                include_similarity BOOLEAN NOT NULL DEFAULT TRUE,
                created_by {ID_TYPE} NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                CONSTRAINT fk_feedback_agent_input_retrieval_rule_input FOREIGN KEY (agent_input_id)
                    REFERENCES feedback_agent_input(agent_input_id) ON DELETE CASCADE,
                CONSTRAINT chk_feedback_agent_input_retrieval_preferred_info_type CHECK (preferred_info_type IN ('text', 'vision', 'mixed')),
                CONSTRAINT chk_feedback_agent_input_retrieval_selection_mode CHECK (selection_mode IN ('top_k', 'all', 'threshold', 'threshold_then_top_k')),
                CONSTRAINT chk_feedback_agent_input_retrieval_max_pages CHECK (max_pages IS NULL OR max_pages >= 1),
                CONSTRAINT chk_feedback_agent_input_retrieval_threshold CHECK (
                    similarity_threshold IS NULL OR (similarity_threshold >= 0 AND similarity_threshold <= 1)
                )
            );
            """,
        ),
        DDLStep(
            "content_question",
            f"""
            CREATE TABLE IF NOT EXISTS content_question (
                question_id {ID_TYPE} PRIMARY KEY,
                current_version_id {ID_TYPE} NULL,
                access_scope VARCHAR(10) NOT NULL DEFAULT 'private',
                is_visible BOOLEAN NOT NULL DEFAULT TRUE,
                created_by {ID_TYPE} NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                CONSTRAINT chk_content_question_access_scope CHECK (access_scope IN ('private', 'public'))
            );
            """,
        ),
        DDLStep(
            "content_question_idx_created_by_visible",
            """
            CREATE INDEX IF NOT EXISTS ix_content_question_created_by_visible
            ON content_question (created_by, is_visible);
            """,
        ),
        DDLStep(
            "content_question_idx_access_scope_visible",
            """
            CREATE INDEX IF NOT EXISTS ix_content_question_access_scope_visible
            ON content_question (access_scope, is_visible);
            """,
        ),
        DDLStep(
            "content_question_version",
            f"""
            CREATE TABLE IF NOT EXISTS content_question_version (
                question_version_id {ID_TYPE} PRIMARY KEY,
                question_id {ID_TYPE} NOT NULL,
                version_no INT NOT NULL,
                question_type VARCHAR(30) NOT NULL,
                title TEXT NULL,
                change_note TEXT NULL,
                score_maximum NUMERIC(10,4) NOT NULL DEFAULT 1,
                score_input_format VARCHAR(20) NOT NULL DEFAULT 'fraction',
                score_normalize_to_maximum BOOLEAN NOT NULL DEFAULT TRUE,
                score_rounding_mode VARCHAR(10) NOT NULL DEFAULT 'none',
                score_rounding_step NUMERIC(10,4) NULL,
                randomize_option_order BOOLEAN NOT NULL DEFAULT TRUE,
                question_vector DOUBLE PRECISION[] NULL,
                question_answer_vector DOUBLE PRECISION[] NULL,
                created_by {ID_TYPE} NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                CONSTRAINT fk_content_question_version_question FOREIGN KEY (question_id)
                    REFERENCES content_question(question_id) ON DELETE CASCADE,
                CONSTRAINT uq_content_question_version_question_version_no UNIQUE (question_id, version_no),
                CONSTRAINT chk_content_question_version_score_maximum CHECK (score_maximum > 0),
                CONSTRAINT chk_content_question_version_score_input_format CHECK (score_input_format IN ('fraction', 'ratio', 'absolute')),
                CONSTRAINT chk_content_question_version_score_rounding_mode CHECK (score_rounding_mode IN ('none', 'floor', 'ceil', 'round')),
                CONSTRAINT chk_content_question_version_score_rounding_step CHECK (score_rounding_step IS NULL OR score_rounding_step > 0)
            );
            """,
        ),
        DDLStep(
            "content_question_version_idx_question_id",
            """
            CREATE INDEX IF NOT EXISTS ix_content_question_version_question_id
            ON content_question_version (question_id);
            """,
        ),
        DDLStep(
            "content_question_version_idx_question_id_version_no",
            """
            CREATE INDEX IF NOT EXISTS ix_content_question_version_question_id_version_no
            ON content_question_version (question_id, version_no);
            """,
        ),
        DDLStep(
            "content_question_version_add_embedding_columns",
            """
            ALTER TABLE content_question_version
            ADD COLUMN IF NOT EXISTS question_vector DOUBLE PRECISION[],
            ADD COLUMN IF NOT EXISTS question_answer_vector DOUBLE PRECISION[];
            """,
        ),
        DDLStep(
            "content_question_version_add_randomize_option_order",
            """
            ALTER TABLE content_question_version
            ADD COLUMN IF NOT EXISTS randomize_option_order BOOLEAN NOT NULL DEFAULT TRUE;
            """,
        ),
        DDLStep(
            "content_question_current_version_fk",
            f"""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'fk_content_question_current_version'
                ) THEN
                    ALTER TABLE content_question
                    ADD CONSTRAINT fk_content_question_current_version
                    FOREIGN KEY (current_version_id) REFERENCES content_question_version(question_version_id);
                END IF;
            END $$;
            """,
        ),
        DDLStep(
            "content_question_content_block",
            f"""
            CREATE TABLE IF NOT EXISTS content_question_content_block (
                content_block_id {ID_TYPE} PRIMARY KEY,
                question_version_id {ID_TYPE} NOT NULL,
                block_order INT NOT NULL,
                block_type VARCHAR(30) NOT NULL,
                text_content TEXT NULL,
                media_url TEXT NULL,
                alt_text TEXT NULL,
                created_by {ID_TYPE} NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                CONSTRAINT fk_content_question_content_block_version FOREIGN KEY (question_version_id)
                    REFERENCES content_question_version(question_version_id) ON DELETE CASCADE,
                CONSTRAINT uq_content_question_content_block_order UNIQUE (question_version_id, block_order)
            );
            """,
        ),
        DDLStep(
            "content_question_interaction",
            f"""
            CREATE TABLE IF NOT EXISTS content_question_interaction (
                interaction_id {ID_TYPE} PRIMARY KEY,
                question_version_id {ID_TYPE} NOT NULL,
                interaction_order INT NOT NULL,
                interaction_type VARCHAR(30) NOT NULL,
                prompt_text TEXT NULL,
                is_required BOOLEAN NOT NULL DEFAULT TRUE,
                max_score NUMERIC(10,4) NULL,
                created_by {ID_TYPE} NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                CONSTRAINT fk_content_question_interaction_version FOREIGN KEY (question_version_id)
                    REFERENCES content_question_version(question_version_id) ON DELETE CASCADE,
                CONSTRAINT uq_content_question_interaction_order UNIQUE (question_version_id, interaction_order),
                CONSTRAINT chk_content_question_interaction_type CHECK (
                    interaction_type IN ('single_choice', 'multi_choice', 'dropdown', 'true_false', 'free_text', 'essay')
                ),
                CONSTRAINT chk_content_question_interaction_max_score CHECK (max_score IS NULL OR max_score >= 0)
            );
            """,
        ),
        DDLStep(
            "content_question_interaction_indexes",
            """
            CREATE INDEX IF NOT EXISTS ix_content_question_interaction_question_version_id
            ON content_question_interaction (question_version_id);
            """,
        ),
        DDLStep(
            "content_question_interaction_option",
            f"""
            CREATE TABLE IF NOT EXISTS content_question_interaction_option (
                interaction_option_id {ID_TYPE} PRIMARY KEY,
                interaction_id {ID_TYPE} NOT NULL,
                option_order INT NOT NULL,
                option_value TEXT NOT NULL,
                option_label TEXT NOT NULL,
                is_correct BOOLEAN NOT NULL DEFAULT FALSE,
                created_by {ID_TYPE} NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                CONSTRAINT fk_content_question_interaction_option_interaction FOREIGN KEY (interaction_id)
                    REFERENCES content_question_interaction(interaction_id) ON DELETE CASCADE,
                CONSTRAINT uq_content_question_interaction_option_order UNIQUE (interaction_id, option_order),
                CONSTRAINT uq_content_question_interaction_option_value UNIQUE (interaction_id, option_value)
            );
            """,
        ),
        DDLStep(
            "content_question_interaction_option_expand_option_value_length",
            """
            ALTER TABLE content_question_interaction_option
            ALTER COLUMN option_value TYPE TEXT;
            """,
        ),
        DDLStep(
            "content_question_interaction_option_indexes",
            """
            CREATE INDEX IF NOT EXISTS ix_content_question_interaction_option_interaction_id
            ON content_question_interaction_option (interaction_id);
            """,
        ),
        DDLStep(
            "content_question_slide_scope",
            f"""
            CREATE TABLE IF NOT EXISTS content_question_slide_scope (
                slide_scope_id {ID_TYPE} PRIMARY KEY,
                question_version_id {ID_TYPE} NOT NULL,
                slide_id UUID NOT NULL,
                page_start INT NULL,
                page_end INT NULL,
                created_by {ID_TYPE} NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                CONSTRAINT fk_content_question_slide_scope_version FOREIGN KEY (question_version_id)
                    REFERENCES content_question_version(question_version_id) ON DELETE CASCADE,
                CONSTRAINT fk_content_question_slide_scope_slide FOREIGN KEY (slide_id)
                    REFERENCES slide(id) ON DELETE CASCADE,
                CONSTRAINT chk_content_question_slide_scope_page_start CHECK (page_start IS NULL OR page_start >= 1),
                CONSTRAINT chk_content_question_slide_scope_page_end CHECK (page_end IS NULL OR page_end >= 1),
                CONSTRAINT chk_content_question_slide_scope_range CHECK (
                    (page_start IS NULL AND page_end IS NULL)
                    OR (page_start IS NOT NULL AND page_end IS NOT NULL AND page_end >= page_start)
                )
            );
            """,
        ),
        DDLStep(
            "content_question_slide_scope_indexes",
            """
            CREATE INDEX IF NOT EXISTS ix_content_question_slide_scope_question_version_id
            ON content_question_slide_scope (question_version_id);
            """,
        ),
        DDLStep(
            "feedback_link",
            f"""
            CREATE TABLE IF NOT EXISTS feedback_link (
                feedback_link_id {ID_TYPE} PRIMARY KEY,
                question_version_id {ID_TYPE} NOT NULL,
                agent_id {ID_TYPE} NOT NULL,
                target_entity_type VARCHAR(30) NOT NULL,
                target_entity_id {ID_TYPE} NOT NULL,
                priority INT NOT NULL DEFAULT 100,
                static_feedback_text TEXT NULL,
                structured_feedback_text TEXT NULL,
                is_visible BOOLEAN NOT NULL DEFAULT TRUE,
                created_by {ID_TYPE} NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                CONSTRAINT fk_feedback_link_question_version FOREIGN KEY (question_version_id)
                    REFERENCES content_question_version(question_version_id) ON DELETE CASCADE,
                CONSTRAINT fk_feedback_link_agent FOREIGN KEY (agent_id)
                    REFERENCES feedback_agent(agent_id) ON DELETE CASCADE,
                CONSTRAINT chk_feedback_link_target_entity_type CHECK (
                    target_entity_type IN ('question_version', 'interaction', 'interaction_option')
                )
            );
            """,
        ),
        DDLStep(
            "feedback_link_idx_question_version_visible_priority",
            """
            CREATE INDEX IF NOT EXISTS ix_feedback_link_question_version_visible_priority
            ON feedback_link (question_version_id, is_visible, priority);
            """,
        ),
        DDLStep(
            "feedback_link_idx_target_entity_visible",
            """
            CREATE INDEX IF NOT EXISTS ix_feedback_link_target_entity_visible
            ON feedback_link (target_entity_type, target_entity_id, is_visible);
            """,
        ),
        DDLStep(
            "feedback_compositions",
            f"""
            CREATE TABLE IF NOT EXISTS feedback_compositions (
                composition_id {ID_TYPE} PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT NULL,
                question_id {ID_TYPE} NULL,
                question_type VARCHAR(10) NULL,
                access_scope VARCHAR(10) NOT NULL DEFAULT 'private',
                created_by {ID_TYPE} NOT NULL,
                updated_by {ID_TYPE} NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
                is_visible BOOLEAN NOT NULL DEFAULT TRUE,
                CONSTRAINT fk_feedback_compositions_question FOREIGN KEY (question_id)
                    REFERENCES content_question(question_id) ON DELETE SET NULL,
                CONSTRAINT chk_feedback_compositions_question_type CHECK (
                    question_type IS NULL OR question_type IN ('mcq', 'oeq')
                ),
                CONSTRAINT chk_feedback_compositions_access_scope CHECK (access_scope IN ('private', 'public'))
            );
            """,
        ),
        DDLStep(
            "feedback_compositions_indexes",
            """
            CREATE INDEX IF NOT EXISTS ix_feedback_compositions_created_by_visible
            ON feedback_compositions (created_by, is_visible);

            CREATE INDEX IF NOT EXISTS ix_feedback_compositions_access_scope_visible
            ON feedback_compositions (access_scope, is_visible);

            CREATE INDEX IF NOT EXISTS ix_feedback_compositions_question_id_visible
            ON feedback_compositions (question_id, is_visible);
            """,
        ),
        DDLStep(
            "feedback_composition_rules",
            f"""
            CREATE TABLE IF NOT EXISTS feedback_composition_rules (
                rule_id {ID_TYPE} PRIMARY KEY,
                composition_id {ID_TYPE} NOT NULL,
                rule_order INT NOT NULL,
                condition_expression TEXT NOT NULL,
                feedback_mode VARCHAR(30) NOT NULL,
                feedback_agent_id {ID_TYPE} NOT NULL,
                slide_mode VARCHAR(30) NOT NULL,
                is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
                CONSTRAINT fk_feedback_composition_rules_composition FOREIGN KEY (composition_id)
                    REFERENCES feedback_compositions(composition_id) ON DELETE CASCADE,
                CONSTRAINT uq_feedback_composition_rules_composition_order UNIQUE (composition_id, rule_order),
                CONSTRAINT chk_feedback_composition_rules_feedback_mode CHECK (
                    feedback_mode IN ('use_latest_version', 'runtime_generate')
                ),
                CONSTRAINT chk_feedback_composition_rules_slide_mode CHECK (
                    slide_mode IN ('most_relevant_slide_page', 'slide_file', 'no_slide')
                )
            );
            """,
        ),
        DDLStep(
            "feedback_composition_rules_indexes",
            """
            CREATE INDEX IF NOT EXISTS ix_feedback_composition_rules_composition_enabled_order
            ON feedback_composition_rules (composition_id, is_enabled, rule_order);
            """,
        ),
        DDLStep(
            "feedback_record_result",
            f"""
            CREATE TABLE IF NOT EXISTS feedback_record_result (
                record_result_id {ID_TYPE} PRIMARY KEY,
                learner_user_id {ID_TYPE} NULL,
                participant_id VARCHAR(255) NULL,
                question_id {ID_TYPE} NOT NULL,
                question_version_id {ID_TYPE} NOT NULL,
                interaction_id {ID_TYPE} NULL,
                feedback_link_id {ID_TYPE} NULL,
                agent_id {ID_TYPE} NULL,
                answer_text TEXT NULL,
                selected_option_ids {ID_TYPE}[] NULL,
                attempt_count INT NULL,
                feedback_text TEXT NULL,
                structured_feedback_text TEXT NULL,
                score_given_raw NUMERIC(10,4) NULL,
                score_given NUMERIC(10,4) NULL,
                score_maximum NUMERIC(10,4) NULL,
                score_input_format VARCHAR(20) NULL,
                score_rounding_mode VARCHAR(10) NULL,
                score_rounding_step NUMERIC(10,4) NULL,
                retrieved_page_count INT NULL,
                reference_slide_id UUID NULL,
                reference_slide_page_number INT NULL,
                preferred_info_type VARCHAR(10) NULL,
                generation_strategy VARCHAR(50) NULL,
                feedback_framework VARCHAR(50) NULL,
                system_total_response_time_ms INT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                CONSTRAINT fk_feedback_record_result_question FOREIGN KEY (question_id)
                    REFERENCES content_question(question_id),
                CONSTRAINT fk_feedback_record_result_question_version FOREIGN KEY (question_version_id)
                    REFERENCES content_question_version(question_version_id),
                CONSTRAINT fk_feedback_record_result_interaction FOREIGN KEY (interaction_id)
                    REFERENCES content_question_interaction(interaction_id),
                CONSTRAINT fk_feedback_record_result_feedback_link FOREIGN KEY (feedback_link_id)
                    REFERENCES feedback_link(feedback_link_id),
                CONSTRAINT fk_feedback_record_result_agent FOREIGN KEY (agent_id)
                    REFERENCES feedback_agent(agent_id),
                CONSTRAINT chk_feedback_record_result_preferred_info_type CHECK (
                    preferred_info_type IS NULL OR preferred_info_type IN ('text', 'vision', 'mixed')
                )
            );
            """,
        ),
        DDLStep(
            "feedback_record_result_idx_question_id_created_at",
            """
            CREATE INDEX IF NOT EXISTS ix_feedback_record_result_question_id_created_at
            ON feedback_record_result (question_id, created_at DESC);
            """,
        ),
        DDLStep(
            "feedback_record_result_idx_participant_created_at",
            """
            CREATE INDEX IF NOT EXISTS ix_feedback_record_result_participant_created_at
            ON feedback_record_result (participant_id, created_at DESC);
            """,
        ),
        DDLStep(
            "feedback_record_result_retrieved_page",
            f"""
            CREATE TABLE IF NOT EXISTS feedback_record_result_retrieved_page (
                retrieved_page_row_id {ID_TYPE} PRIMARY KEY,
                record_result_id {ID_TYPE} NOT NULL,
                rank_index INT NOT NULL,
                slide_id UUID NOT NULL,
                page_number INT NOT NULL,
                similarity NUMERIC(8,6) NULL,
                selected_excerpt TEXT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                CONSTRAINT fk_feedback_record_result_retrieved_page_record FOREIGN KEY (record_result_id)
                    REFERENCES feedback_record_result(record_result_id) ON DELETE CASCADE,
                CONSTRAINT fk_feedback_record_result_retrieved_page_slide FOREIGN KEY (slide_id)
                    REFERENCES slide(id) ON DELETE CASCADE,
                CONSTRAINT uq_feedback_record_result_retrieved_page_rank UNIQUE (record_result_id, rank_index)
            );
            """,
        ),
        DDLStep(
            "feedback_record_result_retrieved_page_indexes",
            """
            CREATE INDEX IF NOT EXISTS ix_feedback_record_result_retrieved_page_record_result_id
            ON feedback_record_result_retrieved_page (record_result_id);
            """,
        ),
    ]


def ensure_semantic_schema(db: Session) -> dict:
    executed: list[str] = []
    for step in _ddl_steps():
        db.execute(text(step.sql))
        executed.append(step.name)
    db.commit()
    return {
        "ok": True,
        "executed_steps": executed,
        "table_prefix_note": "Transitional names use content_/feedback_ prefixes to avoid legacy table collisions.",
    }
