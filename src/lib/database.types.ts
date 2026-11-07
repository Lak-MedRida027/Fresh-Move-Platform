
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "admin_users": {
                  Row: {
                    "created_at": string,"display_name": string,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name"?: string,"role": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor_user_id": string | null,"after": Json | null,"before": Json | null,"created_at": string,"entity": string,"entity_id": string | null,"id": number,"redacted_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_user_id"?: string | null,"after"?: Json | null,"before"?: Json | null,"created_at"?: string,"entity": string,"entity_id"?: string | null,"id"?: never,"redacted_at"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_user_id"?: string | null,"after"?: Json | null,"before"?: Json | null,"created_at"?: string,"entity"?: string,"entity_id"?: string | null,"id"?: never,"redacted_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"job_runs": {
                  Row: {
                    "error": string | null,"finished_at": string | null,"job": string,"ok": boolean | null,"result": NonNullable<Json>,"started_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "error"?: string | null,"finished_at"?: string | null,"job": string,"ok"?: boolean | null,"result"?: NonNullable<Json>,"started_at": string
                  }
                  Update: {
                    "error"?: string | null,"finished_at"?: string | null,"job"?: string,"ok"?: boolean | null,"result"?: NonNullable<Json>,"started_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"members": {
                  Row: {
                    "age": number,"consent_at": string | null,"created_at": string,"full_name": string,"id": string,"notes": string | null,"phone": string,"source": string,"updated_at": string,"wilaya_code": string
                  }
                  ComputedFields: never
                  Insert: {
                    "age": number,"consent_at"?: string | null,"created_at"?: string,"full_name": string,"id"?: string,"notes"?: string | null,"phone": string,"source"?: string,"updated_at"?: string,"wilaya_code": string
                  }
                  Update: {
                    "age"?: number,"consent_at"?: string | null,"created_at"?: string,"full_name"?: string,"id"?: string,"notes"?: string | null,"phone"?: string,"source"?: string,"updated_at"?: string,"wilaya_code"?: string
                  }
                  Relationships: [
                    
                  ]
                },"rate_limits": {
                  Row: {
                    "hits": number,"key": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "hits"?: number,"key": string,"window_start": string
                  }
                  Update: {
                    "hits"?: number,"key"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"reservations": {
                  Row: {
                    "admin_note": string | null,"amount_paid_da": number | null,"anonymised_at": string | null,"cancel_reason": string | null,"cancelled_at": string | null,"code": string,"confirmed_at": string | null,"confirmed_by": string | null,"created_at": string,"hold_expires_at": string | null,"hold_extended_at": string | null,"id": string,"member_id": string | null,"payment_method": string | null,"source": string,"status": string,"trip_id": string,"waitlisted_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_note"?: string | null,"amount_paid_da"?: number | null,"anonymised_at"?: string | null,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"code": string,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"hold_expires_at"?: string | null,"hold_extended_at"?: string | null,"id"?: string,"member_id"?: string | null,"payment_method"?: string | null,"source"?: string,"status": string,"trip_id": string,"waitlisted_at"?: string | null
                  }
                  Update: {
                    "admin_note"?: string | null,"amount_paid_da"?: number | null,"anonymised_at"?: string | null,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"code"?: string,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"hold_expires_at"?: string | null,"hold_extended_at"?: string | null,"id"?: string,"member_id"?: string | null,"payment_method"?: string | null,"source"?: string,"status"?: string,"trip_id"?: string,"waitlisted_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "reservations_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reservations_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"settings": {
                  Row: {
                    "default_hold_hours": number,"id": boolean,"max_age": number,"max_gallery_images": number,"max_pending_per_person": number,"min_age": number,"retention_months": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "default_hold_hours"?: number,"id"?: boolean,"max_age"?: number,"max_gallery_images"?: number,"max_pending_per_person"?: number,"min_age"?: number,"retention_months"?: number,"updated_at"?: string
                  }
                  Update: {
                    "default_hold_hours"?: number,"id"?: boolean,"max_age"?: number,"max_gallery_images"?: number,"max_pending_per_person"?: number,"min_age"?: number,"retention_months"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"trip_images": {
                  Row: {
                    "alt_ar": string,"alt_en": string,"created_at": string,"height": number,"id": string,"kind": string,"path_lg": string,"path_md": string,"path_sm": string,"placeholder": string | null,"size_bytes": number,"sort_order": number,"trip_id": string,"width": number
                  }
                  ComputedFields: never
                  Insert: {
                    "alt_ar"?: string,"alt_en"?: string,"created_at"?: string,"height": number,"id"?: string,"kind": string,"path_lg": string,"path_md": string,"path_sm": string,"placeholder"?: string | null,"size_bytes"?: number,"sort_order"?: number,"trip_id": string,"width": number
                  }
                  Update: {
                    "alt_ar"?: string,"alt_en"?: string,"created_at"?: string,"height"?: number,"id"?: string,"kind"?: string,"path_lg"?: string,"path_md"?: string,"path_sm"?: string,"placeholder"?: string | null,"size_bytes"?: number,"sort_order"?: number,"trip_id"?: string,"width"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "trip_images_trip_id_fkey"
      columns: ["trip_id"]
isOneToOne: false
      referencedRelation: "trips"
      referencedColumns: ["id"]
    }
                  ]
                },"trips": {
                  Row: {
                    "capacity": number | null,"cover_image_id": string | null,"created_at": string,"description_ar": string,"description_en": string,"difficulty": string | null,"end_date": string | null,"featured": boolean,"hold_hours": number,"id": string,"instagram_post_url": string | null,"meeting_point_ar": string | null,"meeting_point_en": string | null,"meeting_time": string | null,"payment_instructions_ar": string,"payment_instructions_en": string,"price_da": number | null,"region": string,"registration_deadline": string | null,"slug": string,"start_date": string | null,"status": string,"summary_ar": string,"summary_en": string,"terrain": (string)[],"title_ar": string,"title_en": string,"updated_at": string,"what_to_bring_ar": string,"what_to_bring_en": string
                  }
                  ComputedFields: never
                  Insert: {
                    "capacity"?: number | null,"cover_image_id"?: string | null,"created_at"?: string,"description_ar"?: string,"description_en"?: string,"difficulty"?: string | null,"end_date"?: string | null,"featured"?: boolean,"hold_hours"?: number,"id"?: string,"instagram_post_url"?: string | null,"meeting_point_ar"?: string | null,"meeting_point_en"?: string | null,"meeting_time"?: string | null,"payment_instructions_ar"?: string,"payment_instructions_en"?: string,"price_da"?: number | null,"region": string,"registration_deadline"?: string | null,"slug": string,"start_date"?: string | null,"status"?: string,"summary_ar"?: string,"summary_en"?: string,"terrain": (string)[],"title_ar": string,"title_en": string,"updated_at"?: string,"what_to_bring_ar"?: string,"what_to_bring_en"?: string
                  }
                  Update: {
                    "capacity"?: number | null,"cover_image_id"?: string | null,"created_at"?: string,"description_ar"?: string,"description_en"?: string,"difficulty"?: string | null,"end_date"?: string | null,"featured"?: boolean,"hold_hours"?: number,"id"?: string,"instagram_post_url"?: string | null,"meeting_point_ar"?: string | null,"meeting_point_en"?: string | null,"meeting_time"?: string | null,"payment_instructions_ar"?: string,"payment_instructions_en"?: string,"price_da"?: number | null,"region"?: string,"registration_deadline"?: string | null,"slug"?: string,"start_date"?: string | null,"status"?: string,"summary_ar"?: string,"summary_en"?: string,"terrain"?: (string)[],"title_ar"?: string,"title_en"?: string,"updated_at"?: string,"what_to_bring_ar"?: string,"what_to_bring_en"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "trips_cover_fk"
      columns: ["cover_image_id"]
isOneToOne: false
      referencedRelation: "trip_images"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "admin_add_manual_reservation":
{ Args: { "p_age": number,"p_confirm"?: boolean,"p_full_name": string,"p_note"?: string,"p_phone": string,"p_trip_id": string,"p_wilaya_code": string }; Returns: Json
                           },
"admin_cancel":
{ Args: { "p_reason": string,"p_reservation_id": string }; Returns: Json
                           },
"admin_confirm":
{ Args: { "p_amount_paid_da": number,"p_override_capacity"?: boolean,"p_payment_method": string,"p_reservation_id": string }; Returns: Json
                           },
"admin_extend_hold":
{ Args: { "p_hours": number,"p_reservation_id": string }; Returns: Json
                           },
"admin_move_to_waitlist":
{ Args: { "p_reservation_id": string }; Returns: Json
                           },
"admin_promote":
{ Args: { "p_reservation_id"?: string,"p_trip_id": string }; Returns: Json
                           },
"admin_reorder_images":
{ Args: { "p_ids": (string)[],"p_trip_id": string }; Returns: Json
                           },
"admin_role":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"admin_storage_usage":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"apply_retention":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"expire_holds":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"hit_rate_limit":
{ Args: { "p_key": string,"p_max": number,"p_window_seconds": number }; Returns: boolean
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_admin_pending_mfa":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_owner":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"join_member":
{ Args: { "p_age": number,"p_consent": boolean,"p_full_name": string,"p_phone": string,"p_wilaya_code": string }; Returns: Json
                           },
"keep_alive":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"log_export":
{ Args: { "p_entity": string,"p_entity_id": string,"p_filter"?: Json,"p_rows": number }; Returns: undefined
                           },
"orphan_image_objects":
{ Args: { "p_limit"?: number,"p_min_age"?: string }; Returns: {
              "name": string,"total_objects": number
            }[]
                           },
"reservation_status":
{ Args: { "p_code": string,"p_phone": string }; Returns: Json
                           },
"reserve_seat":
{ Args: { "p_age": number,"p_consent": boolean,"p_full_name": string,"p_phone": string,"p_trip_id": string,"p_wilaya_code": string }; Returns: Json
                           },
"trip_public_stats":
{ Args: { "p_trip_ids": (string)[] }; Returns: {
              "capacity": number,"seats_left": number,"trip_id": string
            }[]
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
