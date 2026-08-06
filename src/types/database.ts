/**
 * Types Postgres / Supabase — alignés sur supabase/migrations/*
 * Régénérables plus tard via: supabase gen types typescript
 */

export type RiskLevel = "faible" | "modere" | "eleve" | "critique";
export type PromptKey =
  | "classification"
  | "analysis"
  | "reply"
  | "searchIntent";
export type SubscriptionPlan = "free" | "pro" | "team" | "premium";
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "unpaid"
  | "paused";
export type NotificationKind =
  | "deadline_soon"
  | "renewal"
  | "termination"
  | "important_payment"
  | "system";
export type NotificationSeverity = "info" | "warning" | "critical";
export type AnalysisStatus = "pending" | "ok" | "failed";

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          locale: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          locale?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["users"]["Insert"]>;
      };
      folders: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string;
          is_system: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string;
          is_system?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["folders"]["Insert"]>;
      };
      documents: {
        Row: {
          id: string;
          user_id: string;
          folder_id: string | null;
          file_name: string;
          mime_type: string;
          size_bytes: number;
          storage_path: string;
          extracted_text: string | null;
          page_count: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          folder_id?: string | null;
          file_name: string;
          mime_type?: string;
          size_bytes?: number;
          storage_path: string;
          extracted_text?: string | null;
          page_count?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["documents"]["Insert"]>;
      };
      tags: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          slug: string;
          color: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          slug: string;
          color?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tags"]["Insert"]>;
      };
      document_tags: {
        Row: {
          document_id: string;
          tag_id: string;
          created_at: string;
        };
        Insert: {
          document_id: string;
          tag_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["document_tags"]["Insert"]>;
      };
      models: {
        Row: {
          id: string;
          profile_key: string;
          label: string;
          description: string;
          chat_model: string;
          embed_model: string;
          config: Record<string, unknown>;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          profile_key: string;
          label: string;
          description?: string;
          chat_model: string;
          embed_model: string;
          config?: Record<string, unknown>;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["models"]["Insert"]>;
      };
      prompts: {
        Row: {
          id: string;
          key: PromptKey;
          version: number;
          label: string;
          content: string;
          parent_id: string | null;
          note: string | null;
          created_by: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          key: PromptKey;
          version: number;
          label: string;
          content: string;
          parent_id?: string | null;
          note?: string | null;
          created_by?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["prompts"]["Insert"]>;
      };
      analyses: {
        Row: {
          id: string;
          user_id: string;
          document_id: string;
          model_id: string | null;
          status: AnalysisStatus;
          category: string;
          category_label: string;
          confidence: number | null;
          title: string | null;
          document_type: string | null;
          summary: string | null;
          risk_score: number | null;
          risk_level: RiskLevel | null;
          result: Record<string, unknown>;
          ready_reply: Record<string, unknown>;
          prompts_used: unknown[];
          model_name: string | null;
          duration_ms: number | null;
          tokens: Record<string, unknown>;
          error_code: string | null;
          error_message: string | null;
          analyzed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          document_id: string;
          model_id?: string | null;
          status?: AnalysisStatus;
          category?: string;
          category_label?: string;
          confidence?: number | null;
          title?: string | null;
          document_type?: string | null;
          summary?: string | null;
          risk_score?: number | null;
          risk_level?: RiskLevel | null;
          result?: Record<string, unknown>;
          ready_reply?: Record<string, unknown>;
          prompts_used?: unknown[];
          model_name?: string | null;
          duration_ms?: number | null;
          tokens?: Record<string, unknown>;
          error_code?: string | null;
          error_message?: string | null;
          analyzed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["analyses"]["Insert"]>;
      };
      subscriptions: {
        Row: {
          id: string;
          user_id: string;
          plan: SubscriptionPlan;
          status: SubscriptionStatus;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          stripe_price_id: string | null;
          current_period_start: string | null;
          current_period_end: string | null;
          cancel_at_period_end: boolean;
          canceled_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          plan?: SubscriptionPlan;
          status?: SubscriptionStatus;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          stripe_price_id?: string | null;
          current_period_start?: string | null;
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
          canceled_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["subscriptions"]["Insert"]>;
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          analysis_id: string | null;
          document_id: string | null;
          kind: NotificationKind;
          severity: NotificationSeverity;
          title: string;
          message: string;
          evidence: unknown[];
          due_date: string | null;
          amount: number | null;
          fingerprint: string | null;
          read_at: string | null;
          dismissed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          analysis_id?: string | null;
          document_id?: string | null;
          kind: NotificationKind;
          severity?: NotificationSeverity;
          title: string;
          message: string;
          evidence?: unknown[];
          due_date?: string | null;
          amount?: number | null;
          fingerprint?: string | null;
          read_at?: string | null;
          dismissed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Insert"]>;
      };
      evaluations: {
        Row: {
          id: string;
          user_id: string | null;
          analysis_id: string | null;
          relative_path: string;
          category: string;
          file_name: string;
          success: boolean;
          score: number | null;
          expected: Record<string, unknown>;
          predicted: Record<string, unknown>;
          fields: unknown[];
          prompts_used: unknown[];
          model_name: string | null;
          duration_ms: number | null;
          error_message: string | null;
          report_path: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          analysis_id?: string | null;
          relative_path: string;
          category: string;
          file_name: string;
          success?: boolean;
          score?: number | null;
          expected?: Record<string, unknown>;
          predicted?: Record<string, unknown>;
          fields?: unknown[];
          prompts_used?: unknown[];
          model_name?: string | null;
          duration_ms?: number | null;
          error_message?: string | null;
          report_path?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["evaluations"]["Insert"]>;
      };
    };
    Enums: {
      risk_level: RiskLevel;
      prompt_key: PromptKey;
      subscription_plan: SubscriptionPlan;
      subscription_status: SubscriptionStatus;
      notification_kind: NotificationKind;
      notification_severity: NotificationSeverity;
      analysis_status: AnalysisStatus;
    };
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
